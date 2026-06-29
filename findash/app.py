

from flask import (Flask, request, jsonify, render_template,
                   session, redirect, url_for)
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3, os, re
from datetime import datetime
from functools import wraps

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'findash-secret-key-2025-change-in-production')
DB_PATH = os.path.join(os.path.dirname(__file__), 'findash.db')

# ══════════════════════════════════════════════════════
#  DATABASE
# ══════════════════════════════════════════════════════

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name     TEXT    NOT NULL,
            username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT    NOT NULL,
            sq1_question  TEXT,
            sq1_answer    TEXT,
            sq2_question  TEXT,
            sq2_answer    TEXT,
            created_at    TEXT
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL DEFAULT 0,
            type        TEXT    NOT NULL CHECK(type IN ('income','expense')),
            amount      REAL    NOT NULL,
            category    TEXT    NOT NULL,
            description TEXT,
            date        TEXT    NOT NULL,
            created_at  TEXT,
            time_saved  TEXT
        );

        CREATE TABLE IF NOT EXISTS goals (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL DEFAULT 0,
            name         TEXT    NOT NULL,
            target_amt   REAL    NOT NULL,
            saved_amt    REAL    NOT NULL DEFAULT 0,
            deadline     TEXT    NOT NULL,
            created_at   TEXT
        );
    """)

    # ── Safe migrations (run every startup) ──────────────
    def add_col_if_missing(table, col, col_def):
        cols = [r[1] for r in c.execute(f'PRAGMA table_info({table})').fetchall()]
        if col not in cols:
            c.execute(f'ALTER TABLE {table} ADD COLUMN {col} {col_def}')
            print(f'[migrate] Added {col} to {table}')

    add_col_if_missing('transactions', 'user_id',    'INTEGER NOT NULL DEFAULT 0')
    add_col_if_missing('goals',        'user_id',    'INTEGER NOT NULL DEFAULT 0')
    add_col_if_missing('transactions', 'time_saved', 'TEXT')
    add_col_if_missing('transactions', 'created_at', 'TEXT')

    # Back-fill time_saved from created_at for old rows that have it
    c.execute("""
        UPDATE transactions
        SET time_saved = substr(created_at, 12, 8)
        WHERE time_saved IS NULL
          AND created_at IS NOT NULL
          AND length(created_at) >= 19
    """)

    conn.commit()
    conn.close()

init_db()

# ══════════════════════════════════════════════════════
#  HELPERS
# ══════════════════════════════════════════════════════

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def query(sql, args=(), one=False):
    conn = get_db()
    cur  = conn.execute(sql, args)
    rv   = cur.fetchall()
    conn.close()
    return (rv[0] if rv else None) if one else rv

def mutate(sql, args=()):
    conn = get_db()
    cur  = conn.execute(sql, args)
    conn.commit()
    lid  = cur.lastrowid
    conn.close()
    return lid

def valid_session():
    """Return True only if session has a user_id that exists in DB."""
    uid = session.get('user_id')
    if not uid:
        return False
    user = query("SELECT id FROM users WHERE id=?", (uid,), one=True)
    if not user:
        session.clear()   # wipe stale session
        return False
    return True

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not valid_session():
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated

def api_login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not valid_session():
            return jsonify({'error': 'Not authenticated'}), 401
        return f(*args, **kwargs)
    return decorated

def uid():
    return session['user_id']

# ══════════════════════════════════════════════════════
#  BANK MESSAGE PARSER
# ══════════════════════════════════════════════════════

DEBIT_KW  = ['debited','debit',' dr ','spent','paid','payment','withdrawn','charged','purchase']
CREDIT_KW = ['credited','credit',' cr ','received','deposited','refund','cashback','reversal']
AMOUNT_RE = [
    r'(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)',
    r'([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹)',
    r'(?:amount|amt)[:\s]+(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)',
]
DATE_RE = [
    r'(\d{2}[-/]\d{2}[-/]\d{2,4})',
    r'(\d{4}-\d{2}-\d{2})',
    r'(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{2,4})',
]
MERCHANT_RE = [
    r'(?:at|to|from|merchant|towards|via|for)\s+([A-Za-z0-9 &\-\.\']+?)(?:\s+on|\s+ref|\s+upi|\s+txn|\s+vpa|\.|,|$)',
]
CATEGORY_MAP = {
    'Food':          ['zomato','swiggy','restaurant','cafe','food','pizza','burger','kfc','dominos'],
    'Shopping':      ['amazon','flipkart','myntra','ajio','meesho','mall','store','shop','market'],
    'Transport':     ['uber','ola','rapido','petrol','fuel','irctc','railway','bus','metro','toll','fastag'],
    'Entertainment': ['netflix','hotstar','spotify','prime','pvr','inox','movie','cinema','bookmyshow'],
    'Utilities':     ['electricity','water','gas','mobile','recharge','jio','airtel','vi','bsnl','internet'],
    'Health':        ['pharmacy','hospital','clinic','doctor','medicine','apollo','medplus','1mg'],
    'Education':     ['school','college','university','course','udemy','coursera','byju'],
    'Rent':          ['rent','landlord','house','apartment','pg','hostel'],
}

def parse_bank_message(text):
    t = text.lower()
    txn_type = None
    for kw in CREDIT_KW:
        if kw in t:
            txn_type = 'income'; break
    if not txn_type:
        for kw in DEBIT_KW:
            if kw in t:
                txn_type = 'expense'; break
    if not txn_type:
        return None

    amount = None
    for pat in AMOUNT_RE:
        m = re.search(pat, t)
        if m:
            try: amount = float(m.group(1).replace(',', '')); break
            except: pass
    if not amount:
        return None

    date_str = datetime.today().strftime('%Y-%m-%d')
    for pat in DATE_RE:
        m = re.search(pat, t)
        if m:
            raw = m.group(1).strip()
            for fmt_ in ('%d-%m-%Y','%d/%m/%Y','%d-%m-%y','%d/%m/%y',
                         '%Y-%m-%d','%d %b %Y','%d %B %Y','%d %b %y','%d %b. %Y'):
                try:
                    date_str = datetime.strptime(raw, fmt_).strftime('%Y-%m-%d')
                    break
                except: pass
            break

    merchant = ''
    for pat in MERCHANT_RE:
        m = re.search(pat, t)
        if m:
            merchant = m.group(1).strip().title()
            break

    category = 'Other'
    for cat, keywords in CATEGORY_MAP.items():
        if any(kw in t for kw in keywords):
            category = cat
            break

    return {'type': txn_type, 'amount': amount, 'date': date_str,
            'description': merchant or 'Bank Import', 'category': category}

# ══════════════════════════════════════════════════════
#  PAGE ROUTES
# ══════════════════════════════════════════════════════

@app.route('/')
def root():
    if valid_session():
        return redirect(url_for('dashboard'))
    return redirect(url_for('login_page'))

@app.route('/login')
def login_page():
    if valid_session():
        return redirect(url_for('dashboard'))
    return render_template('login.html')

@app.route('/register')
def register_page():
    if valid_session():
        return redirect(url_for('dashboard'))
    return render_template('register.html')

@app.route('/forgot-password')
def forgot_page():
    return render_template('forgot.html')

@app.route('/dashboard')
@login_required
def dashboard():
    user = query("SELECT * FROM users WHERE id=?", (uid(),), one=True)
    return render_template('index.html', user=dict(user))

# ══════════════════════════════════════════════════════
#  AUTH API
# ══════════════════════════════════════════════════════

@app.route('/api/auth/register', methods=['POST'])
def register():
    d         = request.get_json() or {}
    full_name = d.get('full_name','').strip()
    username  = d.get('username','').strip().lower()
    password  = d.get('password','')
    confirm   = d.get('confirm','')

    if not all([full_name, username, password, confirm]):
        return jsonify({'error': 'All fields are required.'}), 400
    if len(username) < 3:
        return jsonify({'error': 'Username must be at least 3 characters.'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters.'}), 400
    if password != confirm:
        return jsonify({'error': 'Passwords do not match.'}), 400
    if query("SELECT id FROM users WHERE username=?", (username,), one=True):
        return jsonify({'error': 'Username already taken. Please choose another.'}), 409

    now = datetime.now().isoformat()
    mutate("INSERT INTO users (full_name, username, password_hash, created_at) VALUES (?,?,?,?)",
           (full_name, username, generate_password_hash(password), now))
    return jsonify({'message': 'Account created successfully.'}), 201

@app.route('/api/auth/login', methods=['POST'])
def login():
    d        = request.get_json() or {}
    username = d.get('username','').strip().lower()
    password = d.get('password','')
    user     = query("SELECT * FROM users WHERE username=?", (username,), one=True)

    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'Invalid username or password.'}), 401

    session.clear()
    session.permanent = True
    session['user_id']   = user['id']
    session['username']  = user['username']
    session['full_name'] = user['full_name']
    return jsonify({'message': 'Login successful.', 'full_name': user['full_name']})

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'message': 'Logged out.'})

@app.route('/api/auth/me')
@api_login_required
def me():
    user = query("SELECT id,full_name,username,sq1_question,sq2_question FROM users WHERE id=?",
                 (uid(),), one=True)
    return jsonify(dict(user))

@app.route('/api/auth/profile', methods=['PUT'])
@api_login_required
def update_profile():
    d = request.get_json() or {}
    full_name = d.get('full_name','').strip()
    if not full_name:
        return jsonify({'error': 'Full name is required.'}), 400
    mutate("UPDATE users SET full_name=? WHERE id=?", (full_name, uid()))
    session['full_name'] = full_name
    return jsonify({'message': 'Profile updated.'})

@app.route('/api/auth/change-password', methods=['PUT'])
@api_login_required
def change_password():
    d       = request.get_json() or {}
    old_pw  = d.get('old_password','')
    new_pw  = d.get('new_password','')
    confirm = d.get('confirm','')
    user    = query("SELECT password_hash FROM users WHERE id=?", (uid(),), one=True)

    if not check_password_hash(user['password_hash'], old_pw):
        return jsonify({'error': 'Current password is incorrect.'}), 400
    if len(new_pw) < 6:
        return jsonify({'error': 'New password must be at least 6 characters.'}), 400
    if new_pw != confirm:
        return jsonify({'error': 'Passwords do not match.'}), 400
    mutate("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(new_pw), uid()))
    return jsonify({'message': 'Password changed successfully.'})

@app.route('/api/auth/security-questions', methods=['PUT'])
@api_login_required
def update_security_questions():
    d  = request.get_json() or {}
    q1 = d.get('sq1_question','').strip()
    a1 = d.get('sq1_answer','').strip().lower()
    q2 = d.get('sq2_question','').strip()
    a2 = d.get('sq2_answer','').strip().lower()
    if not all([q1, a1, q2, a2]):
        return jsonify({'error': 'All question and answer fields are required.'}), 400
    if q1 == q2:
        return jsonify({'error': 'Please select two different questions.'}), 400
    mutate("UPDATE users SET sq1_question=?,sq1_answer=?,sq2_question=?,sq2_answer=? WHERE id=?",
           (q1, a1, q2, a2, uid()))
    return jsonify({'message': 'Security questions saved.'})

@app.route('/api/auth/get-security-questions', methods=['POST'])
def get_security_questions():
    d  = request.get_json() or {}
    un = d.get('username','').strip().lower()
    user = query("SELECT sq1_question,sq2_question FROM users WHERE username=?", (un,), one=True)
    if not user or not user['sq1_question']:
        return jsonify({'error': 'No security questions found for this username. Please contact support.'}), 404
    return jsonify({'sq1': user['sq1_question'], 'sq2': user['sq2_question']})

@app.route('/api/auth/verify-answers', methods=['POST'])
def verify_answers():
    d  = request.get_json() or {}
    un = d.get('username','').strip().lower()
    a1 = d.get('sq1_answer','').strip().lower()
    a2 = d.get('sq2_answer','').strip().lower()
    user = query("SELECT * FROM users WHERE username=?", (un,), one=True)
    if not user:
        return jsonify({'error': 'User not found.'}), 404
    if user['sq1_answer'] != a1 or user['sq2_answer'] != a2:
        return jsonify({'error': 'Incorrect answers. Please try again.'}), 401
    session['reset_user_id'] = user['id']
    return jsonify({'message': 'Answers verified.'})

@app.route('/api/auth/reset-password', methods=['POST'])
def reset_password():
    if 'reset_user_id' not in session:
        return jsonify({'error': 'Session expired. Please start over.'}), 401
    d       = request.get_json() or {}
    new_pw  = d.get('new_password','')
    confirm = d.get('confirm','')
    if len(new_pw) < 6:
        return jsonify({'error': 'Password must be at least 6 characters.'}), 400
    if new_pw != confirm:
        return jsonify({'error': 'Passwords do not match.'}), 400
    mutate("UPDATE users SET password_hash=? WHERE id=?",
           (generate_password_hash(new_pw), session.pop('reset_user_id')))
    return jsonify({'message': 'Password reset successfully.'})

# ══════════════════════════════════════════════════════
#  TRANSACTIONS API
# ══════════════════════════════════════════════════════

@app.route('/api/transactions', methods=['GET'])
@api_login_required
def get_transactions():
    rows = query(
        "SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC, id DESC LIMIT 300",
        (uid(),))
    return jsonify([dict(r) for r in rows])

@app.route('/api/transactions', methods=['POST'])
@api_login_required
def add_transaction():
    d = request.get_json() or {}
    if not all(k in d for k in ('type','amount','category','date')):
        return jsonify({'error': 'Missing required fields.'}), 400
    if d['type'] not in ('income','expense'):
        return jsonify({'error': 'type must be income or expense.'}), 400
    amt = float(d['amount'])
    if amt <= 0:
        return jsonify({'error': 'Amount must be positive.'}), 400
    now       = datetime.now()
    created_at = now.strftime('%Y-%m-%d %H:%M:%S')
    time_saved = now.strftime('%H:%M:%S')
    new_id = mutate(
        "INSERT INTO transactions (user_id,type,amount,category,description,date,created_at,time_saved) VALUES (?,?,?,?,?,?,?,?)",
        (uid(), d['type'], amt, d['category'], d.get('description',''), d['date'], created_at, time_saved))
    return jsonify({'id': new_id, 'message': 'Transaction added.', 'time_saved': time_saved}), 201

@app.route('/api/transactions/<int:tid>', methods=['DELETE'])
@api_login_required
def delete_transaction(tid):
    mutate("DELETE FROM transactions WHERE id=? AND user_id=?", (tid, uid()))
    return jsonify({'message': 'Deleted.'})

@app.route('/api/transactions/import', methods=['POST'])
@api_login_required
def import_transaction():
    d    = request.get_json() or {}
    text = d.get('message','').strip()
    if not text:
        return jsonify({'error': 'No message provided.'}), 400
    parsed = parse_bank_message(text)
    if not parsed:
        return jsonify({'error': 'Could not parse this message. Try adding the transaction manually.'}), 422

    # dry_run: just return parsed, don't save
    if d.get('dry_run'):
        return jsonify({'transaction': parsed})

    now        = datetime.now()
    created_at = now.strftime('%Y-%m-%d %H:%M:%S')
    time_saved = now.strftime('%H:%M:%S')
    new_id = mutate(
        "INSERT INTO transactions (user_id,type,amount,category,description,date,created_at,time_saved) VALUES (?,?,?,?,?,?,?,?)",
        (uid(), parsed['type'], parsed['amount'], parsed['category'], parsed['description'], parsed['date'], created_at, time_saved))
    parsed['id']         = new_id
    parsed['time_saved'] = time_saved
    return jsonify({'message': 'Transaction imported.', 'transaction': parsed}), 201

# ══════════════════════════════════════════════════════
#  GOALS API
# ══════════════════════════════════════════════════════

@app.route('/api/goals', methods=['GET'])
@api_login_required
def get_goals():
    rows = query("SELECT * FROM goals WHERE user_id=? ORDER BY id DESC", (uid(),))
    return jsonify([dict(r) for r in rows])

@app.route('/api/goals', methods=['POST'])
@api_login_required
def add_goal():
    d = request.get_json() or {}
    if not all(k in d for k in ('name','target_amt','deadline')):
        return jsonify({'error': 'Missing required fields.'}), 400
    now = datetime.now().isoformat()
    new_id = mutate(
        "INSERT INTO goals (user_id,name,target_amt,saved_amt,deadline,created_at) VALUES (?,?,?,?,?,?)",
        (uid(), d['name'], float(d['target_amt']), float(d.get('saved_amt',0)), d['deadline'], now))
    return jsonify({'id': new_id, 'message': 'Goal added.'}), 201

@app.route('/api/goals/<int:gid>', methods=['PUT'])
@api_login_required
def update_goal(gid):
    d = request.get_json() or {}
    mutate("UPDATE goals SET saved_amt=? WHERE id=? AND user_id=?", (float(d['saved_amt']), gid, uid()))
    return jsonify({'message': 'Goal updated.'})

@app.route('/api/goals/<int:gid>', methods=['DELETE'])
@api_login_required
def delete_goal(gid):
    mutate("DELETE FROM goals WHERE id=? AND user_id=?", (gid, uid()))
    return jsonify({'message': 'Deleted.'})

# ══════════════════════════════════════════════════════
#  ANALYTICS API
# ══════════════════════════════════════════════════════

def compute_health_score(income, expense, savings_rate, weekend_ratio, goal_count):
    score = 0
    if income > 0:
        score += max(0, min(savings_rate / 50, 1)) * 40
        score += max(0, 1 - (expense / income)) * 30
    score += max(0, 1 - (weekend_ratio / 2)) * 20
    score += min(goal_count, 3) * (10 / 3)
    return round(min(max(score, 0), 100), 1)

@app.route('/api/analytics')
@api_login_required
def analytics():
    txns  = [dict(r) for r in query("SELECT * FROM transactions WHERE user_id=?", (uid(),))]
    goals = [dict(r) for r in query("SELECT * FROM goals WHERE user_id=?", (uid(),))]

    total_income  = sum(t['amount'] for t in txns if t['type'] == 'income')
    total_expense = sum(t['amount'] for t in txns if t['type'] == 'expense')
    balance       = total_income - total_expense
    savings_rate  = (balance / total_income * 100) if total_income > 0 else 0

    today = datetime.today().strftime('%Y-%m-%d')
    daily_income  = sum(t['amount'] for t in txns if t['type']=='income'  and t['date']==today)
    daily_expense = sum(t['amount'] for t in txns if t['type']=='expense' and t['date']==today)

    cat_map = {}
    for t in txns:
        if t['type'] == 'expense':
            cat_map[t['category']] = cat_map.get(t['category'], 0) + t['amount']

    wd_total=we_total=wd_cnt=we_cnt=0
    days_name = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
    weekly = {d: 0 for d in days_name}
    for t in txns:
        if t['type'] == 'expense':
            try:
                dow = datetime.strptime(t['date'], '%Y-%m-%d').weekday()
                weekly[days_name[dow]] += t['amount']
                if dow >= 5: we_total += t['amount']; we_cnt += 1
                else:        wd_total += t['amount']; wd_cnt += 1
            except: pass

    avg_wd = wd_total / wd_cnt if wd_cnt else 0
    avg_we = we_total / we_cnt if we_cnt else 0
    weekend_ratio = (avg_we / avg_wd) if avg_wd > 0 else 1

    monthly = {}
    for t in txns:
        try:
            ym = t['date'][:7]
            if ym not in monthly:
                monthly[ym] = {'income':0,'expense':0}
            monthly[ym][t['type']] += t['amount']
        except: pass
    monthly_sorted = dict(sorted(monthly.items())[-6:])
    monthly_3      = dict(sorted(monthly.items())[-3:])

    health_score = compute_health_score(total_income, total_expense, savings_rate, weekend_ratio, len(goals))

    alerts = []
    if total_expense > 0:
        for cat, amt in cat_map.items():
            pct = amt / total_expense * 100
            if pct > 35:
                alerts.append(f"⚠ '{cat}' accounts for {pct:.1f}% of your total expenses.")
    if weekend_ratio > 1.3:
        alerts.append(f"📅 You spend {((weekend_ratio-1)*100):.0f}% more per day on weekends vs weekdays.")
    if savings_rate < 20 and total_income > 0:
        alerts.append(f"💡 Your savings rate is {savings_rate:.1f}%. Aim for at least 20%.")

    recs = []
    if savings_rate < 20 and total_income > 0:
        needed = total_income * 0.20 - balance
        if needed > 0:
            recs.append(f"Reduce monthly expenses by ₹{needed:,.0f} to reach a 20% savings rate.")
    if cat_map:
        top_cat = max(cat_map, key=cat_map.get)
        recs.append(f"'{top_cat}' is your highest spend category at ₹{cat_map[top_cat]:,.0f}. Review if it can be trimmed.")
    if weekend_ratio > 1.3:
        recs.append("Plan weekend activities in advance to reduce impulse spending.")
    if not goals:
        recs.append("Set at least one financial goal to stay motivated and track progress.")

    planner = []
    today_dt = datetime.today()
    for g in goals:
        try:
            dl = datetime.strptime(g['deadline'], '%Y-%m-%d')
            months_left  = max(1, (dl.year - today_dt.year)*12 + (dl.month - today_dt.month))
            remaining    = g['target_amt'] - g['saved_amt']
            monthly_need = remaining / months_left if remaining > 0 else 0
            monthly_save = savings_rate / 100 * total_income / 12 if total_income > 0 else 0
            planner.append({
                'name': g['name'], 'target': g['target_amt'], 'saved': g['saved_amt'],
                'remaining': remaining, 'months_left': months_left,
                'monthly_needed': round(monthly_need, 2),
                'on_track': monthly_need <= monthly_save,
            })
        except: pass

    return jsonify({
        'total_income': total_income, 'total_expense': total_expense,
        'balance': balance, 'savings_rate': round(savings_rate, 1),
        'daily_income': daily_income, 'daily_expense': daily_expense,
        'health_score': health_score, 'total_transactions': len(txns),
        'category_breakdown': cat_map, 'monthly_trend': monthly_sorted,
        'monthly_3': monthly_3, 'weekly_spending': weekly,
        'weekday_avg': round(avg_wd, 2), 'weekend_avg': round(avg_we, 2),
        'weekend_ratio': round(weekend_ratio, 2),
        'alerts': alerts, 'recommendations': recs,
        'planner': planner, 'goal_count': len(goals),
    })

if __name__ == '__main__':
    app.run(debug=True, port=5000)
