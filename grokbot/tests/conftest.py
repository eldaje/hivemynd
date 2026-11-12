import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
os.environ.setdefault("OPENROUTER_KEY", "test")
os.environ.setdefault("TELEGRAM_TOKEN", "test")
os.environ.setdefault("ALLOWED_USERS", "7")
os.environ.setdefault("DAILY_USER", "40")
os.environ.setdefault("DAILY_GLOBAL", "45")
