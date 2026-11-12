"""Telegram handlers. Guard order: whitelist -> global -> per-user."""
import logging
import os

from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    filters,
)

import config  # noqa: F401 - load .env before os.getenv reads below
import db
import grok

logging.basicConfig(level=logging.INFO)

ALLOWED = {int(x) for x in os.getenv("ALLOWED_USERS", "").split(",") if x}
DAILY_USER = int(os.getenv("DAILY_USER", "40"))
DAILY_GLOBAL = int(os.getenv("DAILY_GLOBAL", "45"))


def _key(update: Update) -> tuple[int, int]:
    return (update.effective_chat.id, update.effective_user.id)


async def _authorized(update: Update) -> bool:
    if update.effective_user.id in ALLOWED:
        return True
    await update.message.reply_text("Not on the list.")
    return False


async def guard(update: Update) -> bool:
    if not await _authorized(update):
        return False
    if db.global_count() >= DAILY_GLOBAL:
        await update.message.reply_text("Global daily cap hit. Back at midnight UTC.")
        return False
    if db.user_count(update.effective_user.id) >= DAILY_USER:
        await update.message.reply_text(f"Your cap of {DAILY_USER} is done for today.")
        return False
    return True


async def on_msg(update: Update, _ctx) -> None:
    if not await guard(update):
        return
    uid = update.effective_user.id
    day = db.bump(uid)

    try:
        await update.message.chat.send_action("typing")
    except Exception:  # noqa: BLE001 - cosmetic, never fatal
        pass

    try:
        reply = await grok.ask(_key(update), update.message.text)
    except Exception:  # noqa: BLE001 - ask should self-contain; belt and brace
        reply = grok.Reply(False, grok.MESSAGES["internal"], "internal")

    if not reply.ok:
        db.unbump(day, uid)
    await update.message.reply_text(reply.text)


async def usage(update: Update, _ctx) -> None:
    if not await _authorized(update):
        return
    uid = update.effective_user.id
    await update.message.reply_text(
        f"you {db.user_count(uid)}/{DAILY_USER} · global "
        f"{db.global_count()}/{DAILY_GLOBAL}"
    )


async def reset(update: Update, _ctx) -> None:
    if not await _authorized(update):
        return
    grok.reset(_key(update))
    await update.message.reply_text("Context cleared.")


def main() -> None:
    app = Application.builder().token(os.environ["TELEGRAM_TOKEN"]).build()
    app.add_handler(CommandHandler("usage", usage))
    app.add_handler(CommandHandler("reset", reset))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_msg))
    app.run_polling()


if __name__ == "__main__":
    main()
