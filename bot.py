import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, ContextTypes

CONFIG = {
    "TOKEN": "8783041803:AAFbNwqYPfAzQjTQMEIObY00d1x8HL0dSqc",
    "IMG": "https://img.freepik.com/free-vector/abstract-technology-particle-background_23-2148426649.jpg",
    "WHEEL_URL": "https://arnan888.github.io/basic-pay/index.html",
    "RACE_URL": "https://arnan888.github.io/basic-pay/race.html"
}

logging.basicConfig(level=logging.WARNING)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🏁 3D 巨幕赛车", url=CONFIG["RACE_URL"]),
         InlineKeyboardButton("🎡 赚赚乐 (V45)", url=CONFIG["WHEEL_URL"])]
    ])
    try:
        await update.message.reply_photo(CONFIG["IMG"], caption="<b>『 💠 DOLA 终端 · 终极版 』</b>\n\n✅ 视觉置顶：已锁定\n✅ 命名同步：赚赚乐 V45\n✅ 路径管理：~/basic-pay", parse_mode="HTML", reply_markup=kb)
    except:
        await update.message.reply_text("💠 DOLA 就绪：", reply_markup=kb)

if __name__ == "__main__":
    app = Application.builder().token(CONFIG["TOKEN"]).build()
    app.add_handler(CommandHandler("start", start))
    print("🚀 DOLA 终极整理版启动成功")
    app.run_polling()
