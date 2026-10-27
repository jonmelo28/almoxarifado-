import { test } from "node:test";
import assert from "node:assert/strict";
import {
  conversationCleanup,
  deleteMessages,
} from "../src/bot/conversation.js";

test("limpeza tenta mensagens individuais quando uma antiga impede o lote", async () => {
  const removed = [];
  const ctx = {
    chat: { id: 99 },
    telegram: {
      callApi: async () => {
        throw { response: { error_code: 400 } };
      },
      deleteMessage: async (_chatId, id) => {
        if (id === 1) throw { response: { error_code: 400 } };
        removed.push(id);
      },
    },
  };
  assert.equal(await deleteMessages(ctx, [1, 2, 2, 3]), false);
  assert.deepEqual(removed, [2, 3]);
});
test("limpeza respeita rate limit sem insistir na API", async () => {
  let individualCalls = 0;
  const ctx = {
    chat: { id: 99 },
    telegram: {
      callApi: async () => {
        throw { response: { error_code: 429 } };
      },
      deleteMessage: async () => {
        individualCalls++;
      },
    },
  };
  assert.equal(await deleteMessages(ctx, [1]), false);
  assert.equal(individualCalls, 0);
});
test("falha ao apagar mensagens não impede a operação e limpeza isola chats", async () => {
  const middleware = conversationCleanup();
  const removed = [];
  const context = (chatId, messageId) => ({
    chat: { id: chatId, type: "private" },
    message: { message_id: messageId },
    reply: async () => ({ message_id: messageId + 1 }),
    telegram: {
      callApi: async (_method, data) => {
        removed.push(data);
        throw new Error("Falha de rede");
      },
    },
  });
  const first = context(10, 1);
  await middleware(first, () => first.reply("Menu"));
  const second = context(20, 5);
  let executed = false;
  await middleware(second, async () => {
    executed = true;
    await second.reply("Menu");
  });
  assert.equal(executed, true);
  assert.ok(
    removed
      .filter((item) => item.chat_id === 20)
      .every((item) => !item.message_ids.includes(2)),
  );
});
