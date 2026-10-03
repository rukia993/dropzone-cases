import { caseById, skinById } from "./catalog.js";
export const MAX_BALANCE = 9_000_000_000_000;
export const MAX_ITEMS = 2000;
export const STORAGE_KEY = "dropzone.v1";
export function initialState() {
  return {
    version: 1,
    balance: 1_000_000,
    inventory: [],
    history: [],
    opened: 0,
    sound: true,
  };
}
export function parseBalance(value) {
  const text = String(value)
    .trim()
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(",", ".");
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(text))
    throw new Error(
      "Введи сумму от 0 до 90 000 000 000 $, не больше двух знаков после запятой.",
    );
  const [whole, fraction = ""] = text.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount > MAX_BALANCE)
    throw new Error("Максимальный баланс — 90 000 000 000 $.");
  return amount;
}
export function normalizeState(raw) {
  const clean = initialState();
  if (!raw || raw.version !== 1) return clean;
  if (
    Number.isSafeInteger(raw.balance) &&
    raw.balance >= 0 &&
    raw.balance <= MAX_BALANCE
  )
    clean.balance = raw.balance;
  if (Number.isSafeInteger(raw.opened) && raw.opened >= 0)
    clean.opened = raw.opened;
  if (typeof raw.sound === "boolean") clean.sound = raw.sound;
  const seen = new Set();
  const validItem = (item) =>
    item &&
    typeof item.id === "string" &&
    item.id.length > 0 &&
    item.id.length <= 80 &&
    skinById.has(item.skinId) &&
    caseById.has(item.caseId) &&
    Number.isSafeInteger(item.createdAt) &&
    item.createdAt >= 0;
  if (Array.isArray(raw.inventory))
    clean.inventory = raw.inventory
      .slice(0, MAX_ITEMS)
      .filter((item) => {
        if (!validItem(item) || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .map(({ id, skinId, caseId, createdAt }) => ({
        id,
        skinId,
        caseId,
        createdAt,
      }));
  if (Array.isArray(raw.history))
    clean.history = raw.history
      .slice(0, 12)
      .filter(validItem)
      .map(({ id, skinId, caseId, createdAt }) => ({
        id,
        skinId,
        caseId,
        createdAt,
      }));
  return clean;
}
export function randomInt(max, cryptoSource = globalThis.crypto) {
  if (!Number.isInteger(max) || max <= 0 || max > 0x1_0000_0000)
    throw new RangeError("Invalid random range");
  const threshold = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  do {
    cryptoSource.getRandomValues(buffer);
  } while (buffer[0] >= threshold);
  return buffer[0] % max;
}
export function pickDrop(caseId, random = randomInt) {
  const item = caseById.get(caseId);
  if (!item) throw new Error("Кейс не найден.");
  let cursor = random(
    item.drops.reduce((total, drop) => total + drop.weight, 0),
  );
  for (const drop of item.drops) {
    cursor -= drop.weight;
    if (cursor < 0) return drop.skinId;
  }
  throw new Error("Не удалось выбрать предмет.");
}
export function openCases(
  state,
  caseId,
  count,
  { random = randomInt, uuid = () => crypto.randomUUID(), now = Date.now } = {},
) {
  const item = caseById.get(caseId);
  if (!item || ![1, 3, 5].includes(count))
    throw new Error("Выбери кейс и количество открытий.");
  if (state.inventory.length + count > MAX_ITEMS)
    throw new Error("Инвентарь заполнен. Продай несколько предметов.");
  const cost = item.price * count;
  if (state.balance < cost)
    throw new Error("Недостаточно баланса. Пополни баланс бесплатно.");
  const ids = new Set(state.inventory.map((entry) => entry.id));
  const drops = Array.from({ length: count }, () => {
    const id = uuid();
    if (ids.has(id)) throw new Error("Повтори открытие.");
    ids.add(id);
    return { id, skinId: pickDrop(caseId, random), caseId, createdAt: now() };
  });
  return {
    state: {
      ...state,
      balance: state.balance - cost,
      inventory: [...drops, ...state.inventory],
      history: [...drops, ...state.history].slice(0, 12),
      opened: Math.min(Number.MAX_SAFE_INTEGER, state.opened + count),
    },
    drops,
  };
}
export function sellItems(state, itemIds) {
  const ids = new Set(itemIds);
  const sold = state.inventory.filter((item) => ids.has(item.id));
  if (!sold.length) throw new Error("Предмет уже продан.");
  const value = sold.reduce(
    (total, item) => total + skinById.get(item.skinId).value,
    0,
  );
  if (state.balance + value > MAX_BALANCE)
    throw new Error("Уменьши баланс перед продажей.");
  return {
    state: {
      ...state,
      balance: state.balance + value,
      inventory: state.inventory.filter((item) => !ids.has(item.id)),
    },
    value,
  };
}
export function createStore(providedStorage) {
  let memory = initialState();
  let storage;
  let persistent = false;
  try {
    storage = providedStorage ?? globalThis.localStorage;
    const saved = storage.getItem(STORAGE_KEY);
    persistent = true;
    try {
      memory = normalizeState(JSON.parse(saved));
    } catch {
      memory = initialState();
    }
  } catch {}
  const read = () => {
    if (!persistent) return structuredClone(memory);
    let raw;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch {
      throw new Error(
        "Не удалось прочитать сохранение. Перезагрузи страницу и проверь доступ к хранилищу.",
      );
    }
    try {
      return normalizeState(JSON.parse(raw));
    } catch {
      return initialState();
    }
  };
  const write = (next) => {
    if (!persistent) {
      memory = next;
      return;
    }
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      throw new Error(
        "Не удалось сохранить изменения. Освободи место в хранилище браузера.",
      );
    }
  };
  let database;
  const databaseLock = (operation) =>
    new Promise((resolve, reject) => {
      const perform = (db) => {
        const transaction = db.transaction("mutex", "readwrite");
        let result;
        const request = transaction.objectStore("mutex").get("state");
        request.onsuccess = () => {
          try {
            result = operation();
          } catch (error) {
            reject(error);
            transaction.abort();
          }
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () =>
          reject(
            new Error("Не удалось заблокировать сохранение. Повтори действие."),
          );
        transaction.onabort = () =>
          reject(new Error("Изменение сохранения отменено."));
      };
      if (database) {
        perform(database);
        return;
      }
      let request;
      let failed = false;
      try {
        request = globalThis.indexedDB.open("dropzone-sync", 1);
      } catch {
        reject(
          new Error(
            "Для сохранения нужен браузер с поддержкой блокировки вкладок.",
          ),
        );
        return;
      }
      request.onupgradeneeded = () => request.result.createObjectStore("mutex");
      request.onerror = () =>
        reject(new Error("Не удалось получить доступ к сохранению."));
      request.onblocked = () => {
        failed = true;
        reject(new Error("Закрой старую вкладку DROPZONE и повтори."));
      };
      request.onsuccess = () => {
        if (failed) {
          request.result.close();
          return;
        }
        const connection = request.result;
        database = connection;
        connection.onversionchange = () => {
          connection.close();
          if (database === connection) database = null;
        };
        perform(connection);
      };
    });
  const transact = async (operation) => {
    const run = () => {
      const result = operation(read());
      write(result.state);
      return result;
    };
    if (!persistent) return run();
    if (globalThis.navigator?.locks?.request)
      return navigator.locks.request("dropzone.state", run);
    return databaseLock(run);
  };
  return {
    read,
    transact,
    get persistent() {
      return persistent;
    },
  };
}
