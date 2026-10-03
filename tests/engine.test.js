import assert from 'node:assert/strict';
import test from 'node:test';
import {cases, skins, skinById} from '../src/catalog.js';
import {MAX_BALANCE, MAX_ITEMS, STORAGE_KEY, createStore, initialState, normalizeState, openCases, parseBalance, pickDrop, randomInt, sellItems} from '../src/engine.js';

function dropOptions(prefix = 'предмет') {
  let index = 0;
  return {uuid: () => `${prefix}-${++index}`, random: () => 0, now: () => 123456};
}

function item(id) {
  return {id, skinId: 'ak-47-elite-build', caseId: 'ember', createdAt: 123456};
}

function storageWith(state = initialState()) {
  const data = new Map([[STORAGE_KEY, JSON.stringify(state)]]);
  return {
    data,
    failRead: false,
    failWrite: false,
    getItem(key) {
      if (this.failRead) throw new Error('Чтение запрещено');
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (this.failWrite) throw new Error('Хранилище заполнено');
      data.set(key, value);
    },
    removeItem(key) {data.delete(key);}
  };
}

function serializedLocks() {
  let queue = Promise.resolve();
  return {
    request(name, operation) {
      assert.equal(name, 'dropzone.state');
      const result = queue.then(operation);
      queue = result.catch(() => {});
      return result;
    }
  };
}

async function withGlobals(descriptors, operation) {
  const previous = new Map(Object.keys(descriptors).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, descriptor] of Object.entries(descriptors)) Object.defineProperty(globalThis, key, {...descriptor, configurable: true});
  try {return await operation();} finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

async function withLocks(operation) {
  return withGlobals({navigator: {value: {locks: serializedLocks()}}}, operation);
}

test('Суммы преобразуются в целые сотые без округления', () => {
  assert.equal(parseBalance('0'), 0);
  assert.equal(parseBalance('0,01'), 1);
  assert.equal(parseBalance('1.2'), 120);
  assert.equal(parseBalance('1 234,56'), 123456);
  assert.equal(parseBalance('90 000 000 000.00'), MAX_BALANCE);
  for (const value of ['-1', '1.001', 'Infinity', 'NaN', '1e2', '90000000000.01', '', '1,2,3']) assert.throws(() => parseBalance(value));
});

test('Цены и стоимости каталога положительны и выражены целыми сотыми', () => {
  assert.equal(new Set(cases.map(entry => entry.id)).size, cases.length);
  assert.equal(new Set(skins.map(entry => entry.id)).size, skins.length);
  for (const entry of cases) assert(Number.isSafeInteger(entry.price) && entry.price > 0 && entry.price <= MAX_BALANCE);
  for (const skin of skins) assert(Number.isSafeInteger(skin.value) && skin.value > 0 && skin.value <= MAX_BALANCE);
});

test('Все границы выпадения точно соответствуют весам каждого кейса', () => {
  for (const entry of cases) {
    const total = entry.drops.reduce((sum, drop) => sum + drop.weight, 0);
    assert.equal(total, 10000);
    const observed = new Map(entry.drops.map(drop => [drop.skinId, 0]));
    assert.equal(observed.size, entry.drops.length);
    for (const drop of entry.drops) {
      assert(skinById.has(drop.skinId));
      assert(Number.isSafeInteger(drop.weight) && drop.weight > 0);
    }
    for (let roll = 0; roll < total; roll++) {
      const id = pickDrop(entry.id, () => roll);
      observed.set(id, observed.get(id) + 1);
    }
    for (const drop of entry.drops) assert.equal(observed.get(drop.skinId), drop.weight, `${entry.id}: ${drop.skinId}`);
  }
});

test('Случайный выбор отбрасывает смещающий остаток диапазона', () => {
  const values = [0xffffffff, 9999];
  let calls = 0;
  assert.equal(randomInt(10000, {getRandomValues(buffer) {calls++; buffer[0] = values.shift();}}), 9999);
  assert.equal(calls, 2);
  assert.equal(randomInt(0x1_0000_0000, {getRandomValues(buffer) {buffer[0] = 0xffffffff;}}), 0xffffffff);
  for (const limit of [0, -1, 1.5, 0x1_0000_0001]) assert.throws(() => randomInt(limit), RangeError);
});

test('Открытие списывает точную стоимость и добавляет выбранное количество предметов', () => {
  for (const count of [1, 3, 5]) {
    const before = initialState();
    const result = openCases(before, 'ember', count, dropOptions(`серия-${count}`));
    assert.equal(result.state.balance, before.balance - 99 * count);
    assert.equal(result.state.inventory.length, count);
    assert.equal(result.drops.length, count);
    assert.equal(result.state.opened, count);
    assert.equal(new Set(result.drops.map(drop => drop.id)).size, count);
    assert.deepEqual(before, initialState());
  }
});

test('Ошибка генератора или повтор идентификатора не изменяют исходное состояние', () => {
  const before = {...initialState(), inventory: [item('старый')]};
  const snapshot = structuredClone(before);
  let draws = 0;
  assert.throws(() => openCases(before, 'ember', 3, {...dropOptions(), random() {if (++draws === 2) throw new Error('Генератор недоступен'); return 0;}}));
  assert.deepEqual(before, snapshot);
  assert.throws(() => openCases(before, 'ember', 3, {...dropOptions(), uuid: () => 'один'}));
  assert.deepEqual(before, snapshot);
  assert.throws(() => openCases(before, 'ember', 1, {...dropOptions(), uuid: () => 'старый'}));
  assert.deepEqual(before, snapshot);
});

test('Неподходящее количество, недостаток баланса и заполненный инвентарь отклоняются', () => {
  assert.throws(() => openCases(initialState(), 'ember', 2, dropOptions()));
  assert.throws(() => openCases(initialState(), 'нет-кейса', 1, dropOptions()));
  assert.throws(() => openCases({...initialState(), balance: 98}, 'ember', 1, dropOptions()));
  const before = {...initialState(), inventory: Array.from({length: MAX_ITEMS - 1}, (_, index) => item(`старый-${index}`))};
  assert.throws(() => openCases(before, 'ember', 3, dropOptions()));
  assert.equal(openCases(before, 'ember', 1, dropOptions()).state.inventory.length, MAX_ITEMS);
  assert.equal(before.inventory.length, MAX_ITEMS - 1);
});

test('Продажа начисляет стоимость один раз даже при повторе идентификаторов', () => {
  const before = {...initialState(), inventory: [item('продаваемый'), item('остаётся')]};
  const result = sellItems(before, ['продаваемый', 'продаваемый']);
  assert.equal(result.value, 39);
  assert.equal(result.state.balance, before.balance + 39);
  assert.deepEqual(result.state.inventory.map(entry => entry.id), ['остаётся']);
  assert.throws(() => sellItems(result.state, ['продаваемый']));
  assert.throws(() => sellItems({...before, balance: MAX_BALANCE - 38}, ['продаваемый']));
  assert.equal(before.inventory.length, 2);
});

test('Повреждённые поля отбрасываются, идентификаторы уникальны, размеры ограничены', () => {
  const raw = {...initialState(), balance: -1, opened: 1.5, sound: 'да', inventory: [item('дубликат'), item('дубликат'), {...item('неизвестный'), skinId: 'нет-скина'}, {...item('время'), createdAt: -1}, ...Array.from({length: MAX_ITEMS + 50}, (_, index) => item(`вещь-${index}`))], history: Array.from({length: 100}, (_, index) => item(`история-${index}`))};
  const normalized = normalizeState(raw);
  assert.equal(normalized.balance, initialState().balance);
  assert.equal(normalized.opened, 0);
  assert.equal(normalized.sound, true);
  assert(normalized.inventory.length <= MAX_ITEMS);
  assert.equal(new Set(normalized.inventory.map(entry => entry.id)).size, normalized.inventory.length);
  assert(!normalized.inventory.some(entry => entry.id === 'неизвестный' || entry.id === 'время'));
  assert.equal(normalized.history.length, 12);
  assert.deepEqual(normalizeState({version: 99}), initialState());
});

test('Переполнение счётчика открытий сохраняет безопасное целое число при восстановлении', () => {
  const result = openCases({...initialState(), opened: Number.MAX_SAFE_INTEGER}, 'ember', 3, dropOptions());
  assert.equal(result.state.opened, Number.MAX_SAFE_INTEGER);
  assert.equal(normalizeState(result.state).opened, Number.MAX_SAFE_INTEGER);
});

test('Завершённое открытие полностью восстанавливается после создания нового хранилища', async () => withLocks(async () => {
  const storage = storageWith();
  const store = createStore(storage);
  const result = await store.transact(state => openCases(state, 'ember', 5, dropOptions()));
  assert.deepEqual(createStore(storage).read(), result.state);
  assert.equal(createStore(storage).read().inventory.length, 5);
}));

test('Ошибка записи отклоняет операцию и сохраняет прежние баланс и инвентарь', async () => withLocks(async () => {
  const before = {...initialState(), balance: 345000, inventory: [item('сохранённый')]};
  const storage = storageWith(before);
  const store = createStore(storage);
  storage.failWrite = true;
  await assert.rejects(store.transact(state => openCases(state, 'ember', 3, dropOptions())), /сохранить/);
  assert.deepEqual(store.read(), before);
  storage.failWrite = false;
  const result = await store.transact(state => openCases(state, 'ember', 3, dropOptions()));
  assert.equal(result.state.balance, before.balance - 297);
  assert.equal(result.state.inventory.length, 4);
}));

test('Ошибка чтения отклоняет операцию без перезаписи старого сохранения', async () => withLocks(async () => {
  const before = {...initialState(), balance: 345000, inventory: [item('сохранённый')]};
  const storage = storageWith(before);
  const store = createStore(storage);
  storage.failRead = true;
  await assert.rejects(store.transact(state => openCases(state, 'ember', 1, dropOptions())), /прочитать/);
  storage.failRead = false;
  assert.deepEqual(store.read(), before);
}));

test('Заполненное хранилище при запуске сохраняет доступность ранее записанных предметов', async () => withLocks(async () => {
  const before = {...initialState(), balance: 12345, inventory: [item('сохранённый')]};
  const storage = storageWith(before);
  storage.failWrite = true;
  const store = createStore(storage);
  assert.equal(store.persistent, true);
  assert.deepEqual(store.read(), before);
  await assert.rejects(store.transact(state => openCases(state, 'ember', 1, dropOptions())), /сохранить/);
  assert.deepEqual(store.read(), before);
}));

test('Недоступный getter localStorage позволяет запустить режим в памяти', async () => withGlobals({localStorage: {get() {throw new Error('SecurityError');}}}, async () => {
  const store = createStore();
  assert.equal(store.persistent, false);
  const result = await store.transact(state => openCases(state, 'ember', 1, dropOptions()));
  assert.deepEqual(store.read(), result.state);
}));

test('Конкурентные открытия через общий mutex сохраняют все списания и предметы', async () => withLocks(async () => {
  const storage = storageWith();
  const stores = [createStore(storage), createStore(storage)];
  const results = await Promise.all(Array.from({length: 40}, (_, index) => stores[index % 2].transact(state => openCases(state, 'ember', 1, dropOptions(`вкладка-${index}`)))));
  const saved = createStore(storage).read();
  assert.equal(results.length, 40);
  assert.equal(saved.balance, initialState().balance - 40 * 99);
  assert.equal(saved.inventory.length, 40);
  assert.equal(saved.opened, 40);
  assert.equal(saved.history.length, 12);
  assert.equal(new Set(saved.inventory.map(entry => entry.id)).size, 40);
}));

test('Одновременная продажа одного предмета начисляет стоимость только одному действию', async () => withLocks(async () => {
  const before = {...initialState(), inventory: [item('общий')]};
  const storage = storageWith(before);
  const stores = [createStore(storage), createStore(storage)];
  const results = await Promise.allSettled(stores.map(store => store.transact(state => sellItems(state, ['общий']))));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(stores[0].read().balance, before.balance + 39);
  assert.equal(stores[0].read().inventory.length, 0);
}));

test('Повреждённый JSON при запуске восстанавливается с дальнейшим сохранением открытий', async () => withLocks(async () => {
  const storage = storageWith();
  storage.data.set(STORAGE_KEY, '{повреждено');
  const store = createStore(storage);
  assert.equal(store.persistent, true);
  const result = await store.transact(state => openCases(state, 'ember', 1, dropOptions()));
  assert.deepEqual(createStore(storage).read(), result.state);
}));

test('Отсутствие обоих способов блокировки отклоняет сохраняемую операцию', async () => withGlobals({navigator: {value: {}}, indexedDB: {value: undefined}}, async () => {
  const before = initialState();
  const storage = storageWith(before);
  const store = createStore(storage);
  await assert.rejects(store.transact(state => openCases(state, 'ember', 1, dropOptions())), /поддержкой блокировки/);
  assert.deepEqual(store.read(), before);
}));

test('Заблокированное открытие IndexedDB не запускает отклонённую операцию позднее', async () => {
  let closed = 0;
  let performed = 0;
  const request = {result: {close() {closed++;}, transaction() {performed++; throw new Error('Операция не должна выполняться');}}};
  await withGlobals({navigator: {value: {}}, indexedDB: {value: {open() {return request;}}}}, async () => {
    const before = initialState();
    const storage = storageWith(before);
    const store = createStore(storage);
    const pending = store.transact(state => openCases(state, 'ember', 1, dropOptions()));
    request.onblocked();
    await assert.rejects(pending, /Закрой старую вкладку/);
    request.onsuccess();
    assert.equal(closed, 1);
    assert.equal(performed, 0);
    assert.deepEqual(store.read(), before);
  });
});


test('Вероятность окупа не превышает 15%, средняя отдача ниже стоимости кейса', () => {
  for (const item of cases) {
    const breakEven = item.drops.reduce((sum, drop) => sum + (skinById.get(drop.skinId).value >= item.price ? drop.weight : 0), 0);
    const expected = item.drops.reduce((sum, drop) => sum + skinById.get(drop.skinId).value * drop.weight / 10000, 0);
    assert(breakEven <= 1500);
    assert(expected < item.price);
  }
});
