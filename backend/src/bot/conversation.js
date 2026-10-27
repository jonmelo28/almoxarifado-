// A API não oferece leitura de todo o histórico. A limpeza automática acompanha
// as respostas desta instância; /limpar também tenta os 100 IDs mais recentes.
export async function deleteMessages(ctx, ids) {
  const unique = [...new Set(ids)].filter(
    (id) => Number.isInteger(id) && id > 0,
  );
  if (!unique.length) return true;
  try {
    await ctx.telegram.callApi("deleteMessages", {
      chat_id: ctx.chat.id,
      message_ids: unique.slice(-100),
    });
    return true;
  } catch (error) {
    if (error.response?.error_code !== 400) return false;
    // Uma mensagem antiga pode impedir o lote, mas não a remoção das recentes.
    let complete = true;
    for (const messageId of unique.slice(-100)) {
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, messageId);
      } catch (failure) {
        complete = false;
        if (failure.response?.error_code !== 400) break;
      }
    }
    return complete;
  }
}

export function conversationCleanup() {
  const chats = new Map();
  const queues = new Map();
  return async (ctx, next) => {
    if (ctx.chat?.type !== "private") return next();
    const chatId = ctx.chat.id;
    const previous = queues.get(chatId) || Promise.resolve();
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    queues.set(chatId, pending);
    await previous;
    try {
      const now = Date.now();
      for (const [id, entry] of chats)
        if (now - entry.at > 48 * 60 * 60000) chats.delete(id);
      const old = chats.get(chatId)?.ids || [];
      const callbackId = ctx.callbackQuery?.message?.message_id;
      await deleteMessages(ctx, [...old, callbackId]);
      const entry = { ids: [], at: now };
      chats.set(chatId, entry);
      const reply = ctx.reply.bind(ctx);
      ctx.reply = async (...args) => {
        const sent = await reply(...args);
        if (sent?.message_id) entry.ids.push(sent.message_id);
        return sent;
      };
      try {
        await next();
      } finally {
        await deleteMessages(ctx, [ctx.message?.message_id]);
      }
    } finally {
      release();
      if (queues.get(chatId) === pending) queues.delete(chatId);
    }
  };
}
