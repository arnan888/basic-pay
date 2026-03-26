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
    # 模拟图片中的矩阵布局
    keyboard = [
        [
            InlineKeyboardButton("🏁 Lucky Racing (赛车)", url=CONFIG["RACE_URL"]),
            InlineKeyboardButton("🎡 赚赚乐 (V45)", url=CONFIG["WHEEL_URL"])
        ],
        [InlineKeyboardButton("💣 扫雷 (100-5)", callback_data='mines')],
        [InlineKeyboardButton("🎵 边玩边听 (Spotify)", url='https://open.spotify.com')],
        [
            InlineKeyboardButton("🧧 领 TRX", callback_data='trx'),
            InlineKeyboardButton("👤 技术支持", url='https://t.me/your_admin')
        ],
        [InlineKeyboardButton("⚙️ 系统后台管理", callback_data='admin')]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    caption = (
        "<b>『 💠 DOLA 终端 · 旗舰版 』</b>\n\n"
        "👤 <b>用户:</b> ✨【 智 能 合 约 】✨【\n"
        "💰 <b>余额:</b> 1000.00 TRX\n\n"
        "45级过载系统已就绪，请选择："
    )

    try:
        await update.message.reply_photo(
            CONFIG["IMG"], 
            caption=caption, 
            parse_mode="HTML", 
            reply_markup=reply_markup
        )
    except:
        await update.message.reply_text(caption, parse_mode="HTML", reply_markup=reply_markup)

if __name__ == "__main__":
    app = Application.builder().token(CONFIG["TOKEN"]).build()
    app.add_handler(CommandHandler("start", start))
    print("🚀 旗舰版机器人已启动")
    app.run_polling()
