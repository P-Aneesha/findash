#  FinDash

## Smart Financial Analysis and Predictive Personal Finance System

FinDash-PFAS is a web-based personal finance management application developed using Flask and MySQL. It helps users manage their income and expenses, monitor financial activities, and gain insights into their spending habits through a simple and user-friendly interface.

---

#  Project Overview

Traditional expense trackers only record financial transactions without providing meaningful insights. FinDash-PFAS is designed to simplify personal finance management by allowing users to securely manage their financial records, monitor spending, and organize their financial information in one place.

---

# ✨ Features

* 🔐 User Registration
* 🔑 User Login
* 🔒 Forgot Password
* 💰 Income Management
* 💸 Expense Management
* 📊 Financial Dashboard
* 🎯 Financial Goal Tracking
* 🔔 Credit & Debit Notifications
* 📱 Responsive User Interface

---

#  Technologies Used

| Technology     | Purpose                       |
| -------------- | ----------------------------- |
| HTML5          | Web Page Structure            |
| CSS3           | Styling and Responsive Design |
| JavaScript     | Client-side Functionality     |
| Python (Flask) | Backend Development           |
| MySQL          | Database Management           |

---

#  Project Structure

```text
FinDash-PFAS/
│
├── templates/
│   ├── index.html
│   ├── login.html
│   ├── register.html
│   └── forgot.html
│
├── static/
│   ├── css/
│   │   ├── style.css
│   │   └── auth.css
│   │
│   └── js/
│       └── app.js
│
├── app.py
└── README.md
```

---

# 📄 File Description

### index.html

The main dashboard where users can manage and view their financial information.

### login.html

Allows registered users to log in securely.

### register.html

Allows new users to create an account.

### forgot.html

Provides password recovery functionality.

### style.css

Contains the main styling for the dashboard and website.

### auth.css

Contains styling for the Login, Register, and Forgot Password pages.

### app.js

Handles frontend functionality such as:

* User interactions
* Form validation
* API requests
* Dynamic page updates

### app.py

The Flask backend application responsible for:

* Routing
* User authentication
* Database connectivity
* Processing user requests

---

# 🗄️ Database

This project uses **MySQL** as the database for storing:

* User Details
* Income Records
* Expense Records
* Financial Goals
* Transaction History

---

# How to Run the Project

1. Clone the repository.

```bash
git clone https://github.com/P-Aneesha/findash.git
```

2. Open the project folder.

3. Configure your MySQL database.

4. Run the Flask application.

```bash
python app.py
```

5. Open your browser and visit:

```text
http://127.0.0.1:5000
```

---

#  Future Enhancements

* Budget Planning
* Expense Prediction
* Financial Reports
* AI-based Spending Analysis
* Mobile Application

---

# Developer

**Aneesha Reddy**

GitHub: https://github.com/P-Aneesha

---

# 📄 License

This project was developed as an academic mini project for learning and educational purposes.
