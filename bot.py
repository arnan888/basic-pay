import logging
import json
import os
import random
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, MessageHandler, filters, ContextTypes

# ==================== 配置 ====================
logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.WARNING)
TOKEN = "8783041803:AAFbNwqYPfAzQjTQMEIObY00d1x8HL0dSqc"  # 请替换为你的 Bot Token
DATA_FILE = "users.json"
# 游戏网页地址（龙虎斗按钮链接）
GAME_URL = "https://arnan888.github.io/basic-pay/index.html?user_id=6685731895"
# 音乐链接（保留）
MUSIC_URL = "https://open.spotify.com"

ADMIN_ID = None

# ==================== 数据库操作 ====================
def load_db():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_db(db):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)

def is_admin(uid):
    global ADMIN_ID
    if ADMIN_ID is None:
        return False
    return str(uid) == str(ADMIN_ID)

# ==================== 主菜单 ====================
async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    global ADMIN_ID
    user = update.effective_user
    db = load_db()
    uid = str(user.id)

    # 设置管理员（第一个启动的用户）
    if ADMIN_ID is None:
        ADMIN_ID = uid
        with open("admin_config.json", "w") as f:
            json.dump({"admin_id": uid}, f)
        print(f"✅ 管理员已设置: {uid}")

    # 初始化用户
    if uid not in db:
        db[uid] = {"name": user.first_name, "money": 0}
        save_db(db)
    elif "money" not in db[uid]:
        db[uid]["money"] = 0
        save_db(db)

    # 构建键盘：龙虎斗（链接）、刷新资产、签到、领TRX、边玩边听、技术支持
    kb = [
        [InlineKeyboardButton("🐉 龙虎斗", url=GAME_URL),
         InlineKeyboardButton("📊 刷新资产", callback_data="refresh")],
        [InlineKeyboardButton("🧧 领取签到", callback_data="sign"),
         InlineKeyboardButton("🎁 领TRX", callback_data="claim_trx")],
        [InlineKeyboardButton("🎵 边玩边听", url=MUSIC_URL),
         InlineKeyboardButton("🛠️ 技术支持", callback_data="support")],
    ]
    # 管理员额外添加管理后台按钮
    if is_admin(uid):
        kb.append([InlineKeyboardButton("🔧 管理后台", callback_data="admin_panel")])

    text = (f"<b>『 💠 DOLA 链上终端 』</b>\n\n"
            f"👤 交易员: {db[uid]['name']}\n"
            f"💰 账户余额: <code>{db[uid]['money']:.2f}</code> TRX\n"
            f"🔗 网页同步: <b>已就绪</b>")

    await update.message.reply_text(text, parse_mode="HTML", reply_markup=InlineKeyboardMarkup(kb))

# 刷新主菜单（编辑消息时使用）
async def refresh_main_menu(query, uid, db):
    kb = [
        [InlineKeyboardButton("🐉 龙虎斗", url=GAME_URL),
         InlineKeyboardButton("📊 刷新资产", callback_data="refresh")],
        [InlineKeyboardButton("🧧 领取签到", callback_data="sign"),
         InlineKeyboardButton("🎁 领TRX", callback_data="claim_trx")],
        [InlineKeyboardButton("🎵 边玩边听", url=MUSIC_URL),
         InlineKeyboardButton("🛠️ 技术支持", callback_data="support")],
    ]
    if is_admin(uid):
        kb.append([InlineKeyboardButton("🔧 管理后台", callback_data="admin_panel")])

    text = (f"<b>『 💠 DOLA 链上终端 』</b>\n\n"
            f"👤 交易员: {db[uid]['name']}\n"
            f"💰 账户余额: <code>{db[uid]['money']:.2f}</code> TRX\n"
            f"🔗 网页同步: <b>已就绪</b>")

    await query.edit_message_text(text, parse_mode="HTML", reply_markup=InlineKeyboardMarkup(kb))

# ==================== 简单功能 ====================
async def handle_refresh(query, uid, db):
    await query.edit_message_text(f"🔄 当前余额: {db[uid]['money']:.2f} TRX", reply_markup=query.message.reply_markup)

async def handle_sign(query, uid, db):
    db[uid]["money"] = db[uid].get("money", 0) + 10
    save_db(db)
    await query.answer("签到成功 +10 TRX", show_alert=True)
    await refresh_main_menu(query, uid, db)

async def handle_claim_trx(query, uid, db):
    db[uid]["money"] = db[uid].get("money", 0) + 5
    save_db(db)
    await query.answer("领取成功 +5 TRX", show_alert=True)
    await refresh_main_menu(query, uid, db)

async def handle_support(query):
    kb = [[InlineKeyboardButton("🔙 返回", callback_data="back_to_main")]]
    await query.edit_message_text("🛠️ 技术支持\n联系管理员", parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))

# ==================== 管理后台 ====================
async def admin_panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    uid = str(query.from_user.id)
    if not is_admin(uid):
        await query.answer("无权限", show_alert=True)
        return
    await query.answer()
    kb = [
        [InlineKeyboardButton("📋 用户列表", callback_data="admin_list")],
        [InlineKeyboardButton("➕ 上分", callback_data="admin_add_menu")],
        [InlineKeyboardButton("➖ 下分", callback_data="admin_sub_menu")],
        [InlineKeyboardButton("🔍 查余额", callback_data="admin_balance_menu")],
        [InlineKeyboardButton("🔙 返回主页", callback_data="back_to_main")]
    ]
    await query.edit_message_text("🔧 管理后台\n请选择操作:", parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))

async def admin_list(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    uid = str(query.from_user.id)
    if not is_admin(uid):
        return
    await query.answer()
    db_full = load_db()
    if not db_full:
        await query.edit_message_text("暂无用户数据", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 返回", callback_data="admin_panel")]]))
        return
    msg = "📋 用户列表\n\n"
    for i, (uid_str, data) in enumerate(list(db_full.items())[:20]):
        msg += f"{i+1}. ID: {uid_str} | {data.get('name', '未知')} | 余额: {data.get('money', 0)} TRX\n"
    kb = [[InlineKeyboardButton("🔙 返回", callback_data="admin_panel")]]
    await query.edit_message_text(msg, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))

def amount_keyboard(target_uid, action):
    amounts = [10, 50, 100, 200, 500]
    kb = []
    row = []
    for amt in amounts:
        row.append(InlineKeyboardButton(f"{amt}", callback_data=f"{action}_amt_{target_uid}_{amt}"))
        if len(row) == 3:
            kb.append(row)
            row = []
    if row:
        kb.append(row)
    kb.append([InlineKeyboardButton("🔢 自定义金额", callback_data=f"{action}_custom_{target_uid}")])
    kb.append([InlineKeyboardButton("🔙 返回", callback_data="admin_panel")])
    return kb

async def admin_add_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    uid = str(query.from_user.id)
    if not is_admin(uid):
        return
    await query.answer()
    db = load_db()
    if not db:
        await query.edit_message_text("暂无用户", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 返回", callback_data="admin_panel")]]))
        return
    kb = []
    for i, (uid_str, data) in enumerate(list(db.items())[:20]):
        name = data.get("name", "未知")
        kb.append([InlineKeyboardButton(f"{i+1}. {name} ({uid_str})", callback_data=f"add_user_{uid_str}")])
    kb.append([InlineKeyboardButton("🔙 返回", callback_data="admin_panel")])
    context.user_data["admin_action_type"] = "add"
    await query.edit_message_text("➕ 上分 - 选择用户", parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))

async def admin_sub_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    uid = str(query.from_user.id)
    if not is_admin(uid):
        return
    await query.answer()
    db = load_db()
    if not db:
        await query.edit_message_text("暂无用户", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 返回", callback_data="admin_panel")]]))
        return
    kb = []
    for i, (uid_str, data) in enumerate(list(db.items())[:20]):
        name = data.get("name", "未知")
        kb.append([InlineKeyboardButton(f"{i+1}. {name} ({uid_str})", callback_data=f"sub_user_{uid_str}")])
    kb.append([InlineKeyboardButton("🔙 返回", callback_data="admin_panel")])
    context.user_data["admin_action_type"] = "sub"
    await query.edit_message_text("➖ 下分 - 选择用户", parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))

async def admin_balance_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    uid = str(query.from_user.id)
    if not is_admin(uid):
        return
    await query.answer()
    db = load_db()
    if not db:
        await query.edit_message_text("暂无用户", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 返回", callback_data="admin_panel")]]))
        return
    kb = []
    for i, (uid_str, data) in enumerate(list(db.items())[:20]):
        name = data.get("name", "未知")
        bal = data.get("money", 0)
        kb.append([InlineKeyboardButton(f"{i+1}. {name} ({uid_str}) - {bal} TRX", callback_data=f"balance_user_{uid_str}")])
    kb.append([InlineKeyboardButton("🔙 返回", callback_data="admin_panel")])
    await query.edit_message_text("🔍 查余额 - 选择用户", parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))

async def handle_admin_user_select(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    admin_uid = str(query.from_user.id)
    if not is_admin(admin_uid):
        await query.answer("无权限", show_alert=True)
        return
    await query.answer()
    data = query.data
    parts = data.split("_")
    action = parts[0]
    target_uid = parts[2]
    if action == "add":
        kb = amount_keyboard(target_uid, "add")
        await query.edit_message_text(f"➕ 上分 - 用户 {target_uid}\n选择金额:", parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))
    elif action == "sub":
        kb = amount_keyboard(target_uid, "sub")
        await query.edit_message_text(f"➖ 下分 - 用户 {target_uid}\n选择金额:", parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))
    elif action == "balance":
        db = load_db()
        bal = db.get(target_uid, {}).get("money", 0)
        await query.edit_message_text(f"💰 用户 {target_uid}\n余额: {bal} TRX", parse_mode="Markdown", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 返回", callback_data="admin_panel")]]))

async def handle_amount_select(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    admin_uid = str(query.from_user.id)
    if not is_admin(admin_uid):
        await query.answer("无权限", show_alert=True)
        return
    await query.answer()
    data = query.data
    parts = data.split("_")
    action = parts[0]
    target_uid = parts[2]
    amount = int(parts[3])
    db = load_db()
    if action == "add":
        if target_uid not in db:
            db[target_uid] = {"name": "用户", "money": 0}
        db[target_uid]["money"] = db[target_uid].get("money", 0) + amount
        save_db(db)
        new_bal = db[target_uid]["money"]
        await query.edit_message_text(f"✅ 上分成功\n用户: {target_uid}\n增加: {amount} TRX\n新余额: {new_bal} TRX", parse_mode="Markdown", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 返回后台", callback_data="admin_panel")]]))
    elif action == "sub":
        if target_uid not in db:
            await query.edit_message_text("用户不存在", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 返回", callback_data="admin_panel")]]))
            return
        current = db[target_uid].get("money", 0)
        if amount > current:
            await query.edit_message_text(f"❌ 余额不足\n当前余额: {current} TRX", parse_mode="Markdown", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 返回", callback_data="admin_panel")]]))
            return
        db[target_uid]["money"] = current - amount
        save_db(db)
        new_bal = db[target_uid]["money"]
        await query.edit_message_text(f"✅ 下分成功\n用户: {target_uid}\n扣除: {amount} TRX\n新余额: {new_bal} TRX", parse_mode="Markdown", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 返回后台", callback_data="admin_panel")]]))

async def custom_amount_prompt(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    admin_uid = str(query.from_user.id)
    if not is_admin(admin_uid):
        await query.answer("无权限", show_alert=True)
        return
    await query.answer()
    data = query.data
    parts = data.split("_")
    action = parts[0]
    target_uid = parts[2]
    context.user_data["custom_action"] = action
    context.user_data["custom_target"] = target_uid
    await query.edit_message_text(f"请输入金额（数字）:\n用户: {target_uid}", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 取消", callback_data="admin_panel")]]))

async def handle_custom_amount(update: Update, context: ContextTypes.DEFAULT_TYPE):
    admin_uid = str(update.effective_user.id)
    if not is_admin(admin_uid):
        await update.message.reply_text("无权限")
        return
    action = context.user_data.get("custom_action")
    target_uid = context.user_data.get("custom_target")
    if not action or not target_uid:
        return
    try:
        amount = int(update.message.text.strip())
        if amount <= 0:
            await update.message.reply_text("金额必须大于0")
            return
        db = load_db()
        if action == "add":
            if target_uid not in db:
                db[target_uid] = {"name": "用户", "money": 0}
            db[target_uid]["money"] = db[target_uid].get("money", 0) + amount
            save_db(db)
            await update.message.reply_text(f"✅ 上分成功\n用户: {target_uid}\n增加: {amount}\n新余额: {db[target_uid]['money']:.2f}")
        elif action == "sub":
            if target_uid not in db:
                await update.message.reply_text("用户不存在")
                return
            current = db[target_uid].get("money", 0)
            if amount > current:
                await update.message.reply_text(f"余额不足，当前: {current:.2f}")
                return
            db[target_uid]["money"] = current - amount
            save_db(db)
            await update.message.reply_text(f"✅ 下分成功\n用户: {target_uid}\n扣除: {amount}\n新余额: {db[target_uid]['money']:.2f}")
        context.user_data["custom_action"] = None
        context.user_data["custom_target"] = None
    except:
        await update.message.reply_text("请输入数字金额")

# ==================== 回调处理 ====================
async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    uid = str(query.from_user.id)
    db = load_db()
    await query.answer()
    data = query.data

    if data == "refresh":
        await handle_refresh(query, uid, db)
    elif data == "sign":
        await handle_sign(query, uid, db)
    elif data == "claim_trx":
        await handle_claim_trx(query, uid, db)
    elif data == "support":
        await handle_support(query)
    elif data == "back_to_main":
        await refresh_main_menu(query, uid, db)
    elif data == "admin_panel":
        await admin_panel(update, context)
    elif data == "admin_list":
        await admin_list(update, context)
    elif data == "admin_add_menu":
        await admin_add_menu(update, context)
    elif data == "admin_sub_menu":
        await admin_sub_menu(update, context)
    elif data == "admin_balance_menu":
        await admin_balance_menu(update, context)
    elif data.startswith("add_user_") or data.startswith("sub_user_") or data.startswith("balance_user_"):
        await handle_admin_user_select(update, context)
    elif data.startswith("add_amt_") or data.startswith("sub_amt_"):
        await handle_amount_select(update, context)
    elif data.startswith("add_custom_") or data.startswith("sub_custom_"):
        await custom_amount_prompt(update, context)
    # 注意：已删除龙虎斗游戏内部回调，因为按钮已改为链接

# ==================== 文本输入处理（用于自定义金额） ====================
async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if context.user_data.get("custom_action"):
        await handle_custom_amount(update, context)
        return

# ==================== 加载管理员ID ====================
def load_admin_id():
    global ADMIN_ID
    try:
        with open("admin_config.json", "r") as f:
            config = json.load(f)
            ADMIN_ID = config.get("admin_id")
            if ADMIN_ID:
                print(f"✅ 已加载管理员ID: {ADMIN_ID}")
    except:
        pass

# ==================== 主函数 ====================
def main():
    load_admin_id()
    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", start_cmd))
    app.add_handler(CallbackQueryHandler(handle_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    print("🚀 DOLA Bot 已启动（无大转盘，龙虎斗按钮为网页链接）")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()