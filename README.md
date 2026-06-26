---
title: KarirOScope Dashboard
emoji: 📊
colorFrom: blue
colorTo: purple
sdk: docker
pinned: false
---

# KarirOScope
**Live Dashboard:** [https://huggingface.co/spaces/dapp-eng/kariroscope-dashboard](https://huggingface.co/spaces/dapp-eng/kariroscope-dashboard)

KarirOScope is an interactive dashboard and data pipeline built for analyzing job market trends, specifically targeting tech and data roles in Indonesia. It collects, cleans, and visualizes job posting data to uncover insights such as top skills, hiring companies, work modes (remote/onsite), and average salaries.

## Features
- **Interactive Dashboard**: Built with Flask and Plotly for dynamic data visualization.
- **Live Scanner**: Scrape LinkedIn job postings in real-time and analyze them directly from the dashboard.
- **Skill Extraction**: Uses KeyBERT to automatically extract relevant technical skills from raw job descriptions.
- **Exploratory Data Analysis (EDA)**: Includes Jupyter notebooks for deep-dive data cleaning, processing, and visualization.

## Directory Structure
- `/dashboard`: Contains the Flask web application, static assets (JS/CSS), and pre-processed data.
- `/notebook`: Contains Jupyter notebooks used for initial scraping, data cleaning, and EDA.

## Local Development

### Requirements
- Python 3.10+
- `pip` package manager

### Setup
1. Clone this repository:
   ```bash
   git clone https://github.com/dapp-eng/KarirOScope.git
   cd KarirOScope
   ```
2. Navigate to the dashboard directory:
   ```bash
   cd dashboard
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Run the development server:
   ```bash
   python app.py
   ```
5. Open your browser and navigate to `http://localhost:5000`.

## Tech Stack
- **Backend**: Python, Flask, Pandas, KeyBERT
- **Frontend**: HTML/CSS, Vanilla JavaScript, Plotly.js
- **Data Collection**: JobSpy (LinkedIn/Indeed scraper)
