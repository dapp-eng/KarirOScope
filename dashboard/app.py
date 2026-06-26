import os
import ast
import json
import time
import uuid
import threading
import warnings
from datetime import datetime
from collections import Counter
from pathlib import Path
import numpy as np
import pandas as pd

os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
from flask import Flask, jsonify, request, render_template, send_file

warnings.filterwarnings("ignore")
app = Flask(__name__, static_folder="static", template_folder="templates")
app.secret_key = os.environ.get("SECRET_KEY", "kos-intel-2024-x9k")
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data" / "processed"
_cache = {}
_scans = {}
_keybert_model = None
_keybert_available = False
_keybert_init_lock = threading.Lock()


def _get_keybert():
    global _keybert_model, _keybert_available
    if _keybert_model is not None:
        return _keybert_model
    with _keybert_init_lock:
        if _keybert_model is not None:
            return _keybert_model
        try:
            from keybert import KeyBERT
            from sentence_transformers import SentenceTransformer

            _keybert_model = KeyBERT(model=SentenceTransformer("all-MiniLM-L6-v2"))
            _keybert_available = True
            return _keybert_model
        except Exception:
            _keybert_available = False
            return None


def extract_skills_keybert(text, top_n=8):
    if not text or len(str(text).strip()) < 10:
        return []
    model = _get_keybert()
    if model is None:
        return []
    try:
        text_str = str(text)
        chunk_size = 1500
        chunks = [text_str[i : i + chunk_size] for i in range(0, len(text_str), chunk_size)]
        all_keywords = []
        for chunk in chunks:
            if len(chunk.strip()) < 10:
                continue
            keywords = model.extract_keywords(
                chunk,
                keyphrase_ngram_range=(1, 2),
                stop_words="english",
                top_n=top_n,
            )
            all_keywords.extend([kw[0] for kw in keywords])
        kw_counts = Counter(all_keywords)
        return [kw for kw, count in kw_counts.most_common(top_n)]
    except Exception as e:
        print(f"KeyBERT error: {e}")
        return []


def _read_csv(name):
    path = DATA_DIR / name
    if not path.exists():
        return pd.DataFrame()
    try:
        return pd.read_csv(path)
    except Exception:
        return pd.DataFrame()


def _read_json(name):
    path = DATA_DIR / name
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _to_records(df):
    if df is None or df.empty:
        return []
    df = df.copy()
    for c in df.select_dtypes(include=["float64", "float32"]).columns:
        df[c] = df[c].where(df[c].notna(), None)
    return df.to_dict(orient="records")


def _parse_list_col(val):
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return []
    if isinstance(val, list):
        return val
    s = str(val).strip()
    if s.startswith("["):
        try:
            return ast.literal_eval(s)
        except Exception:
            return []
    return []


def _extract_city(loc_str):
    if not loc_str or (isinstance(loc_str, float) and np.isnan(loc_str)):
        return "Unknown"
    loc = str(loc_str).lower()
    cities = [
        "jakarta",
        "surabaya",
        "bandung",
        "bali",
        "yogyakarta",
        "semarang",
        "medan",
        "makassar",
        "malang",
        "denpasar",
        "tangerang",
        "bekasi",
        "depok",
        "bogor",
        "solo",
        "pekanbaru",
        "batam",
        "palembang",
    ]
    for city in cities:
        if city in loc:
            return city.title()
    if any(r in loc for r in ["remote", "wfh", "anywhere", "virtual"]):
        return "Remote"
    parts = str(loc_str).split(",")
    return parts[0].strip().title() if parts else str(loc_str).title()


def _compute_kpis(meta, df_idn, df_content, df_companies):
    kpis = {}
    if meta:
        kpis["job_query"] = meta.get("job_query", "")
        kpis["location_query"] = meta.get("location_query", "")
        kpis["ig_username"] = meta.get("ig_username", "belajarlinkedin")
        kpis["date_range"] = meta.get("date_range", "N/A")
        kpis["run_timestamp"] = meta.get("run_timestamp", "")
        kpis["total_jobs"] = meta.get("total_indonesia") or meta.get("total_jobs", 0)
    if not df_idn.empty:
        kpis["total_jobs"] = kpis.get("total_jobs") or len(df_idn)
        if "company_name" in df_idn.columns:
            kpis["unique_companies"] = int(df_idn["company_name"].nunique())
        if "job_category" in df_idn.columns:
            vc = df_idn["job_category"].value_counts()
            if len(vc):
                kpis["top_category"] = str(vc.index[0])
                kpis["top_category_count"] = int(vc.iloc[0])
        if "location" in df_idn.columns:
            kpis["unique_locations"] = int(df_idn["location"].nunique())
    elif not df_companies.empty:
        kpis.setdefault("unique_companies", len(df_companies))
    if not df_content.empty:
        kpis["total_ig_posts"] = len(df_content)
        if "engagement_rate" in df_content.columns:
            kpis["ig_avg_er"] = round(float(df_content["engagement_rate"].mean()), 3)
        if "likes" in df_content.columns:
            kpis["ig_total_likes"] = int(df_content["likes"].sum())
        if "follower_count" in df_content.columns:
            first_valid = df_content["follower_count"].dropna()
            if len(first_valid):
                kpis["ig_followers"] = int(first_valid.iloc[0])
    return kpis


def _category_dist(df_idn):
    if df_idn.empty or "job_category" not in df_idn.columns:
        return []
    counts = df_idn["job_category"].value_counts().reset_index()
    counts.columns = ["job_category", "count"]
    total = counts["count"].sum()
    counts["percentage"] = (counts["count"] / total * 100).round(1)
    return _to_records(counts)


def _location_dist(df_idn):
    if df_idn.empty or "location" not in df_idn.columns:
        return []
    df = df_idn.copy()
    df["city"] = df["location"].apply(_extract_city)
    counts = df["city"].value_counts().head(10).reset_index()
    counts.columns = ["city", "count"]
    total = counts["count"].sum()
    counts["percentage"] = (counts["count"] / total * 100).round(1)
    return _to_records(counts)


def load_data():
    global _cache
    meta = _read_json("metadata.json")
    df_idn = _read_csv("df_indonesia.csv")
    df_skills = _read_csv("skill_frequency.csv")
    df_cat_skills = _read_csv("category_skills.csv")
    df_companies = _read_csv("top_companies.csv")
    df_trend = _read_csv("posting_trend.csv")
    df_content = _read_csv("content_performance.csv")
    df_type_perf = _read_csv("type_performance.csv")
    df_topic_perf = _read_csv("topic_performance.csv")
    df_day = _read_csv("day_pattern.csv")
    df_monthly = _read_csv("monthly_trend.csv")
    df_hashtag = _read_csv("hashtag_freq.csv")
    df_gap = _read_csv("gap_analysis.csv")
    df_recs = _read_csv("recommendations.csv")
    if not df_day.empty:
        cols = df_day.columns.tolist()
        if len(cols) == 2:
            df_day.columns = ["day_of_week", "engagement_rate"]
    if not df_content.empty and "hashtags" in df_content.columns:
        df_content["hashtags"] = df_content["hashtags"].apply(_parse_list_col)
    salary_stats = {}
    salary_by_cat = []
    if not df_idn.empty:
        df_temp = df_idn.copy()
        for sc in ["min_amount", "max_amount"]:
            if sc not in df_temp.columns:
                df_temp[sc] = np.nan
        df_temp["_avg_s"] = df_temp[["min_amount", "max_amount"]].mean(axis=1)
        has_s = df_temp["_avg_s"].notna()
        if has_s.sum() > 0:
            salary_stats = {
                "avg": round(float(df_temp.loc[has_s, "_avg_s"].mean()), 0),
                "min": (
                    round(float(df_temp["min_amount"].dropna().min()), 0)
                    if df_temp["min_amount"].notna().any()
                    else 0
                ),
                "max": (
                    round(float(df_temp["max_amount"].dropna().max()), 0)
                    if df_temp["max_amount"].notna().any()
                    else 0
                ),
                "pct_disclosed": round(float(has_s.sum() / max(len(df_temp), 1) * 100), 1),
                "count": int(has_s.sum()),
                "currency": (
                    str(df_temp["currency"].dropna().iloc[0])
                    if "currency" in df_temp.columns and df_temp["currency"].notna().any()
                    else "USD"
                ),
            }
            if "job_category" in df_temp.columns:
                for cat in df_temp["job_category"].dropna().unique():
                    cdf = df_temp[(df_temp["job_category"] == cat) & has_s]
                    if len(cdf) >= 2:
                        salary_by_cat.append(
                            {
                                "job_category": cat,
                                "avg_salary": round(float(cdf["_avg_s"].mean()), 0),
                                "count": int(len(cdf)),
                            }
                        )
                salary_by_cat.sort(key=lambda x: x["avg_salary"], reverse=True)
    freshness = {"hot": 0, "fresh": 0, "active": 0, "aging": 0, "unknown": 0}
    if not df_idn.empty and "posted_date" in df_idn.columns:
        try:
            now = pd.Timestamp.now()
            days = (now - pd.to_datetime(df_idn["posted_date"], errors="coerce")).dt.days
            freshness = {
                "hot": int((days <= 7).sum()),
                "fresh": int(((days > 7) & (days <= 14)).sum()),
                "active": int(((days > 14) & (days <= 30)).sum()),
                "aging": int((days > 30).sum()),
                "unknown": int(days.isna().sum()),
            }
        except Exception:
            pass
    remote_stats = {"remote": 0, "onsite": 0, "unknown": 0}
    if not df_idn.empty and "is_remote" in df_idn.columns:
        try:
            col = df_idn["is_remote"].astype(str).str.lower()
            remote_stats = {
                "remote": int((col == "true").sum()),
                "onsite": int((col == "false").sum()),
                "unknown": int(((col != "true") & (col != "false")).sum()),
            }
        except Exception:
            pass
    has_data = bool(meta) or not df_idn.empty or not df_skills.empty
    _cache = {
        "metadata": meta,
        "kpis": _compute_kpis(meta, df_idn, df_content, df_companies),
        "skills": _to_records(df_skills),
        "category_skills": _to_records(df_cat_skills),
        "categories": _category_dist(df_idn),
        "companies": _to_records(df_companies),
        "trend": _to_records(df_trend),
        "locations": _location_dist(df_idn),
        "instagram": {
            "type_performance": _to_records(df_type_perf),
            "topic_performance": _to_records(df_topic_perf),
            "day_pattern": _to_records(df_day),
            "monthly_trend": _to_records(df_monthly),
            "hashtags": _to_records(df_hashtag),
        },
        "gap_analysis": _to_records(df_gap),
        "recommendations": _to_records(df_recs),
        "salary_stats": salary_stats,
        "salary_by_category": salary_by_cat,
        "freshness": freshness,
        "remote_stats": remote_stats,
        "data_status": {
            "jobs": not df_idn.empty,
            "skills": not df_skills.empty,
            "companies": not df_companies.empty,
            "trend": not df_trend.empty,
            "instagram": not df_content.empty,
            "gap": not df_gap.empty,
            "recommendations": not df_recs.empty,
            "metadata": bool(meta),
            "has_data": has_data,
        },
        "loaded_at": datetime.now().isoformat(),
    }
    return _cache


load_data()
SCAN_SKILLS = [
    "sql",
    "python",
    "excel",
    "power bi",
    "tableau",
    "looker",
    "looker studio",
    "machine learning",
    "deep learning",
    "tensorflow",
    "pytorch",
    "pandas",
    "numpy",
    "scikit-learn",
    "r programming",
    "java",
    "javascript",
    "typescript",
    "react",
    "vue",
    "angular",
    "node.js",
    "aws",
    "gcp",
    "azure",
    "docker",
    "kubernetes",
    "git",
    "spark",
    "hadoop",
    "airflow",
    "dbt",
    "bigquery",
    "snowflake",
    "mongodb",
    "postgresql",
    "mysql",
    "redis",
    "data visualization",
    "business intelligence",
    "etl",
    "google analytics",
    "google sheets",
    "figma",
    "photoshop",
    "seo",
    "sem",
    "kotlin",
    "swift",
    "flutter",
    "android",
    "ios",
    "php",
    "laravel",
    "django",
    "flask",
    "spring",
    "golang",
    "statistics",
    "data engineering",
    "data science",
    "nlp",
    "computer vision",
    "restful api",
    "microservices",
    "agile",
    "scrum",
]
SCAN_CATEGORIES = {
    "Data and Technology": [
        "data",
        "analyst",
        "scientist",
        "analytics",
        "sql",
        "python",
        "machine learning",
        "ml",
        "ai",
        "bi",
        "business intelligence",
        "tableau",
        "power bi",
        "spark",
        "hadoop",
        "etl",
        "database",
        "statistic",
    ],
    "Software Engineering": [
        "software",
        "developer",
        "backend",
        "frontend",
        "fullstack",
        "full stack",
        "mobile",
        "android",
        "ios",
        "flutter",
        "react",
        "devops",
        "cloud",
        "aws",
        "gcp",
        "azure",
        "programmer",
        "engineer",
    ],
    "Marketing and Content": [
        "content",
        "writer",
        "copywriter",
        "creative",
        "social media",
        "digital marketing",
        "seo",
        "sem",
        "campaign",
        "brand",
        "growth",
        "performance marketing",
    ],
    "Sales and Business Development": [
        "sales",
        "business development",
        "account manager",
        "account executive",
        "partnership",
        "revenue",
        "customer success",
    ],
    "People and HR": ["hr", "human resource", "talent", "recruitment", "payroll", "training"],
    "Finance and Operations": [
        "finance",
        "accounting",
        "audit",
        "tax",
        "financial",
        "budgeting",
        "treasury",
    ],
    "Product and Design": [
        "product manager",
        "product owner",
        "ux",
        "ui",
        "user experience",
        "designer",
        "design",
        "figma",
    ],
    "Operations and Supply Chain": [
        "operation",
        "supply chain",
        "logistics",
        "warehouse",
        "procurement",
        "inventory",
    ],
    "Customer Service": [
        "customer service",
        "customer support",
        "call center",
        "helpdesk",
        "technical support",
    ],
}


def _classify_job(title):
    t = str(title).lower()
    for cat, kws in SCAN_CATEGORIES.items():
        if any(kw in t for kw in kws):
            return cat
    return "General Business"


def _safe_str(val):
    if val is None:
        return ""
    if isinstance(val, float) and np.isnan(val):
        return ""
    return str(val)


def _process_scan_df(df, keyword, location, use_keybert=False):
    if df.empty:
        return {}
    df = df.copy()
    rename = {"title": "job_title", "company": "company_name", "date_posted": "posted_date"}
    for old, new in rename.items():
        if old in df.columns and new not in df.columns:
            df.rename(columns={old: new}, inplace=True)
    for col in ["job_title", "company_name", "location", "description"]:
        if col not in df.columns:
            df[col] = ""
    df["description"] = df["description"].fillna("")
    df["job_category"] = df["job_title"].apply(_classify_job)
    skill_counter = Counter()
    descriptions = df["description"].tolist()
    for desc in descriptions:
        d = str(desc).lower()
        for sk in SCAN_SKILLS:
            if sk in d:
                skill_counter[sk] += 1
    if use_keybert:
        sample_for_keybert = descriptions[:50]
        for desc in sample_for_keybert:
            keybert_skills = extract_skills_keybert(desc, top_n=8)
            for sk in keybert_skills:
                sk_clean = str(sk).lower().strip()
                if sk_clean and len(sk_clean) > 2:
                    skill_counter[sk_clean] += 1
    top_skills = [{"skill": s, "frequency": c} for s, c in skill_counter.most_common(20)]
    cat_counts = df["job_category"].value_counts().reset_index()
    cat_counts.columns = ["job_category", "count"]
    total = cat_counts["count"].sum()
    cat_counts["percentage"] = (cat_counts["count"] / total * 100).round(1)
    companies = []
    if "company_name" in df.columns:
        cc = df["company_name"].value_counts().head(20).reset_index()
        cc.columns = ["company_name", "job_count"]
        companies = cc.to_dict(orient="records")
    trend = []
    if "posted_date" in df.columns:
        try:
            df["posted_date"] = pd.to_datetime(df["posted_date"], errors="coerce")
            df["year_month"] = df["posted_date"].dt.to_period("M").astype(str)
            t_df = df.groupby("year_month").size().reset_index(name="posting_count")
            trend = t_df.sort_values("year_month").to_dict(orient="records")
        except Exception:
            pass
    df["city"] = df["location"].apply(_extract_city)
    lc = df["city"].value_counts().head(10).reset_index()
    lc.columns = ["city", "count"]
    tot_l = lc["count"].sum()
    lc["percentage"] = (lc["count"] / tot_l * 100).round(1)
    table_cols = [
        "job_title",
        "company_name",
        "location",
        "job_category",
        "posted_date",
        "job_url",
        "job_type",
        "is_remote",
        "min_amount",
        "max_amount",
        "currency",
    ]
    available = [c for c in table_cols if c in df.columns]
    jobs_list = []
    for _, row in df[available].iterrows():
        entry = {}
        for c in available:
            entry[c] = _safe_str(row[c])
        jobs_list.append(entry)
    salary_stats = {}
    salary_by_cat = []
    for sc in ["min_amount", "max_amount"]:
        if sc not in df.columns:
            df[sc] = np.nan
    df["_avg_s"] = df[["min_amount", "max_amount"]].mean(axis=1)
    has_s = df["_avg_s"].notna()
    if has_s.sum() > 0:
        salary_stats = {
            "avg": round(float(df.loc[has_s, "_avg_s"].mean()), 0),
            "min": (
                round(float(df["min_amount"].dropna().min()), 0)
                if df["min_amount"].notna().any()
                else 0
            ),
            "max": (
                round(float(df["max_amount"].dropna().max()), 0)
                if df["max_amount"].notna().any()
                else 0
            ),
            "pct_disclosed": round(float(has_s.sum() / max(len(df), 1) * 100), 1),
            "count": int(has_s.sum()),
            "currency": (
                str(df["currency"].dropna().iloc[0])
                if "currency" in df.columns and df["currency"].notna().any()
                else "USD"
            ),
        }
        for cat in df["job_category"].unique():
            cdf = df[(df["job_category"] == cat) & has_s]
            if len(cdf) >= 2:
                salary_by_cat.append(
                    {
                        "job_category": cat,
                        "avg_salary": round(float(cdf["_avg_s"].mean()), 0),
                        "count": int(len(cdf)),
                    }
                )
        salary_by_cat.sort(key=lambda x: x["avg_salary"], reverse=True)
    freshness = {"hot": 0, "fresh": 0, "active": 0, "aging": 0, "unknown": 0}
    if "posted_date" in df.columns:
        try:
            now = pd.Timestamp.now()
            days = (now - pd.to_datetime(df["posted_date"], errors="coerce")).dt.days
            freshness = {
                "hot": int((days <= 7).sum()),
                "fresh": int(((days > 7) & (days <= 14)).sum()),
                "active": int(((days > 14) & (days <= 30)).sum()),
                "aging": int((days > 30).sum()),
                "unknown": int(days.isna().sum()),
            }
        except Exception:
            pass
    remote_stats = {"remote": 0, "onsite": 0, "unknown": 0}
    if "is_remote" in df.columns:
        try:
            col = df["is_remote"].astype(str).str.lower()
            remote_stats = {
                "remote": int((col == "true").sum()),
                "onsite": int((col == "false").sum()),
                "unknown": int(((col != "true") & (col != "false")).sum()),
            }
        except Exception:
            pass
    df_gap = _read_csv("gap_analysis.csv")
    recs = []
    gap_records = []
    ig_username = _cache.get("kpis", {}).get("ig_username", "belajarlinkedin")
    total_ig_posts = _cache.get("kpis", {}).get("total_ig_posts", 0)
    ig_avg_er = _cache.get("kpis", {}).get("ig_avg_er", 0)
    if not df_gap.empty:
        THEME_KEYWORDS = {
            "Technical Skills & Tools": [
                "excel",
                "sql",
                "data analysis",
                "python",
                "tableau",
                "power bi",
                "machine learning",
                "javascript",
                "react",
                "java",
                "data",
                "analyst",
                "developer",
                "engineer",
            ],
            "Leadership & Management": [
                "management",
                "coordinate",
                "strategic",
                "lead",
                "manager",
                "leadership",
                "mentor",
                "supervise",
            ],
            "Problem Solving & Analytical": [
                "problem solving",
                "data driven",
                "analytical thinking",
                "analytical",
                "logic",
                "critical thinking",
                "troubleshoot",
            ],
            "Soft Skills & Communication": [
                "collaboration",
                "verbal",
                "presentation",
                "communication",
                "teamwork",
                "written",
                "interpersonal",
                "communicate",
            ],
            "Networking & Relationship": [
                "stakeholder",
                "cross functional",
                "relationship",
                "networking",
                "client",
                "partner",
            ],
            "Work Culture & Adaptability": [
                "initiative",
                "agile",
                "proactive",
                "adaptable",
                "fast paced",
                "dynamic",
                "culture",
            ],
            "Interview & Job Application Prep": [
                "recruitment",
                "interview",
                "portfolio",
                "cv",
                "resume",
                "hiring",
                "apply",
                "onboarding",
            ],
            "Career Development": [
                "training",
                "certification",
                "career growth",
                "learning",
                "development",
                "mentoring",
                "course",
            ],
            "Industry Knowledge": [
                "business process",
                "business acumen",
                "industry trend",
                "market research",
                "competitor",
                "market",
            ],
            "Personal Branding & LinkedIn": [
                "linkedin",
                "visibility",
                "profile",
                "branding",
                "social media",
                "brand",
                "network",
            ],
        }
        total_jobs = max(len(df), 1)
        desc_lower = [str(d).lower() for d in df["description"].tolist()]
        theme_freqs = {}
        theme_top_kws = {}
        for theme, kws in THEME_KEYWORDS.items():
            job_kw_counter = Counter()
            jobs_with_theme = 0
            for desc in desc_lower:
                found_any = False
                for kw in kws:
                    if kw in desc:
                        job_kw_counter[kw] += 1
                        found_any = True
                if found_any:
                    jobs_with_theme += 1
            theme_freqs[theme] = min(jobs_with_theme / total_jobs, 1.0)
            theme_top_kws[theme] = [kw for kw, _ in job_kw_counter.most_common(3)]
        for i, row in df_gap.iterrows():
            theme = row["content_topic"]
            market_freq = theme_freqs.get(theme, 0.0)
            cov_rate = row.get("coverage_rate", 0.0)
            gap_score = market_freq * (1.0 - min(cov_rate * 3.0, 1.0))
            df_gap.at[i, "market_frequency"] = round(market_freq, 3)
            df_gap.at[i, "gap_score"] = round(gap_score, 3)
            df_gap.at[i, "opportunity_score"] = round(gap_score * 100.0, 2)
            top_kws = theme_top_kws.get(theme, [])
            if top_kws:
                df_gap.at[i, "top_keywords_in_jobs"] = str(top_kws)
        df_gap = df_gap.sort_values("opportunity_score", ascending=False).reset_index(drop=True)
        gap_records = df_gap.to_dict(orient="records")
        for i, row in df_gap.head(5).iterrows():
            theme = row["content_topic"]
            opp = row["opportunity_score"]
            freq_pct = round(row["market_frequency"] * 100, 1)
            posts = int(row["posts_count"])
            avg_er = row["avg_engagement_rate"]
            kw_str = (
                str(row["top_keywords_in_jobs"]).replace("[", "").replace("]", "").replace("'", "")
            )
            if posts == 0:
                coverage_note = f"@{ig_username} has never created content on this topic out of {total_ig_posts} total posts."
            else:
                coverage_note = f"Only {posts} post{'s' if posts > 1 else ''} {'have' if posts > 1 else 'has'} covered this topic — far below the high market demand."
            if avg_er > 0:
                er_comparison = "above" if avg_er > ig_avg_er else "below"
                er_note = f" Existing posts on this topic average {avg_er}% engagement rate ({er_comparison} the account average of {round(ig_avg_er, 2)}%)."
            else:
                er_note = ""
            reasoning = (
                f"{freq_pct}% of '{keyword}' job postings in {location} mention this topic — "
                f"employers actively look for this in candidates. "
                f"{coverage_note} "
                f"Most frequently mentioned keywords in job postings: {kw_str}.{er_note}"
            )
            recs.append(
                {
                    "rank": i + 1,
                    "content_topic": theme,
                    "opportunity_score": opp,
                    "market_frequency_pct": f"{freq_pct}%",
                    "posts_count": posts,
                    "coverage_rate": row["coverage_rate"],
                    "avg_engagement_rate": avg_er,
                    "top_keywords": kw_str,
                    "recommended_format": "Image",
                    "recommended_frequency": "3x per week" if opp > 50 else "2x per week",
                    "reasoning": reasoning,
                }
            )
    return {
        "kpis": {
            "total_jobs": len(df),
            "unique_companies": (
                int(df["company_name"].nunique()) if "company_name" in df.columns else 0
            ),
            "top_category": (
                str(df["job_category"].value_counts().index[0]) if len(df) > 0 else "N/A"
            ),
            "job_query": keyword,
            "location_query": location,
            "date_range": "Live Scan",
            "run_timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "is_live_scan": True,
            "pct_remote": remote_stats["remote"] / max(len(df), 1) * 100,
            "pct_with_salary": salary_stats.get("pct_disclosed", 0),
            "freshness_hot": freshness["hot"],
        },
        "skills": top_skills,
        "categories": cat_counts.to_dict(orient="records"),
        "companies": companies,
        "trend": trend,
        "locations": lc.to_dict(orient="records"),
        "jobs_list": jobs_list,
        "salary_stats": salary_stats,
        "salary_by_category": salary_by_cat,
        "freshness": freshness,
        "remote_stats": remote_stats,
        "gap_analysis": gap_records,
        "recommendations": recs,
    }


def _run_scan(scan_id, keyword, location, limit, use_keybert=False):
    reg = _scans[scan_id]
    try:
        reg.update({"status": "running", "progress": 5, "message": "Initializing scanner..."})
        try:
            from jobspy import scrape_jobs
        except ImportError:
            reg.update({"status": "error", "error": "python-jobspy not installed on this server."})
            return
        skill_note = " + KeyBERT AI" if use_keybert else ""
        reg.update(
            {
                "progress": 15,
                "message": f'Connecting to LinkedIn - searching "{keyword}" in {location}...',
            }
        )
        time.sleep(0.5)
        reg.update(
            {"progress": 25, "message": "Fetching job listings (this may take 1-3 minutes)..."}
        )
        jobs_df = scrape_jobs(
            site_name=["linkedin"],
            search_term=keyword,
            location=location,
            results_wanted=min(int(limit), 500),
            hours_old=8760,
            linkedin_fetch_description=True,
        )
        reg.update({"progress": 70, "message": f"Found {len(jobs_df)} jobs. Deduplicating..."})
        jobs_df = (
            jobs_df.drop_duplicates(subset=["description"]).copy() if not jobs_df.empty else jobs_df
        )
        skill_msg = f"Extracting skills{skill_note} and categorizing..."
        reg.update({"progress": 80, "message": skill_msg})
        result = _process_scan_df(jobs_df, keyword, location, use_keybert=use_keybert)
        reg.update({"progress": 95, "message": "Finalizing analysis..."})
        time.sleep(0.3)
        reg.update(
            {
                "progress": 100,
                "status": "done",
                "message": f'Done - {result["kpis"]["total_jobs"]} jobs analyzed.',
                "result": result,
            }
        )
    except Exception as exc:
        reg.update({"status": "error", "error": str(exc), "message": f"Scan failed: {exc}"})


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/data")
def api_data():
    return jsonify(_cache)


@app.route("/api/reload")
def api_reload():
    load_data()
    return jsonify({"status": "ok", "loaded_at": _cache.get("loaded_at")})


@app.route("/api/wordcloud")
def api_wordcloud():
    path = DATA_DIR / "wordcloud_skills.png"
    if path.exists():
        return send_file(str(path), mimetype="image/png")
    return "", 404


@app.route("/api/wordcloud/data")
def api_wordcloud_data():
    return jsonify(_cache.get("skills", []))


@app.route("/api/capabilities")
def api_capabilities():
    try:
        _get_keybert()
    except Exception:
        pass
    return jsonify(
        {
            "keybert": _keybert_available,
            "skill_method": (
                "KeyBERT + Keyword-based (hybrid)"
                if _keybert_available
                else "Keyword-based (built-in)"
            ),
        }
    )


@app.route("/api/scan/start", methods=["POST"])
def scan_start():
    body = request.get_json() or {}
    keyword = body.get("keyword", "").strip()
    location = body.get("location", "Indonesia").strip()
    limit = body.get("limit", 100)
    use_keybert = bool(body.get("use_keybert", False))
    if not keyword:
        return jsonify({"error": "keyword required"}), 400
    sid = str(uuid.uuid4())[:8]
    _scans[sid] = {
        "status": "pending",
        "progress": 0,
        "message": "Queued...",
        "result": None,
        "error": None,
        "created_at": datetime.now().isoformat(),
    }
    t = threading.Thread(
        target=_run_scan, args=(sid, keyword, location, limit, use_keybert), daemon=True
    )
    t.start()
    return jsonify({"scan_id": sid})


@app.route("/api/scan/status/<sid>")
def scan_status(sid):
    if sid not in _scans:
        return jsonify({"error": "not found"}), 404
    job = _scans[sid]
    out = {
        "scan_id": sid,
        "status": job["status"],
        "progress": job["progress"],
        "message": job["message"],
    }
    if job["status"] == "done":
        out["result"] = job["result"]
    elif job["status"] == "error":
        out["error"] = job.get("error")
    return jsonify(out)


@app.errorhandler(404)
def not_found(e):
    return render_template("error.html", code=404, msg="Page not found."), 404


@app.errorhandler(500)
def server_error(e):
    return render_template("error.html", code=500, msg="Internal server error."), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
