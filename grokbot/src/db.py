"""UTC day-keyed SQLite counters. Persist across restarts."""
import datetime
import sqlite3

import config

DB = config.DB


def _c() -> sqlite3.Connection:
    c = sqlite3.connect(DB)
    c.execute(
        "CREATE TABLE IF NOT EXISTS usage("
        "day TEXT, uid INTEGER, n INTEGER, PRIMARY KEY(day, uid))"
    )
    return c


def today() -> str:
    """UTC day key. Matches the promised midnight UTC reset."""
    return datetime.datetime.now(datetime.UTC).date().isoformat()


def bump(uid: int) -> str:
    """Charge one message. Returns the day key to refund against."""
    day = today()
    c = _c()
    c.execute(
        "INSERT INTO usage VALUES(?,?,1) "
        "ON CONFLICT(day,uid) DO UPDATE SET n=n+1",
        (day, uid),
    )
    c.commit()
    c.close()
    return day


def unbump(day: str, uid: int) -> None:
    """Refund the exact record that was charged, even across midnight."""
    c = _c()
    c.execute(
        "UPDATE usage SET n=n-1 WHERE day=? AND uid=? AND n>0", (day, uid)
    )
    c.commit()
    c.close()


def user_count(uid: int) -> int:
    c = _c()
    r = c.execute("SELECT n FROM usage WHERE day=? AND uid=?", (today(), uid)).fetchone()
    c.close()
    return r[0] if r else 0


def global_count() -> int:
    c = _c()
    r = c.execute("SELECT SUM(n) FROM usage WHERE day=?", (today(),)).fetchone()
    c.close()
    return r[0] or 0
