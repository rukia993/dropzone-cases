import {cases, caseById, skinById, rarities} from './catalog.js';
import {createStore, openCases, sellItems, parseBalance, pickDrop, STORAGE_KEY} from './engine.js';
import {Sounds} from './audio.js';
const $ = selector => document.querySelector(selector);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const balanceFormat = new Intl.NumberFormat('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const money = value => balanceFormat.format(value / 100);
const escape = text => String(text).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const store = createStore();
let state = store.read();
const sounds = new Sounds(state.sound);
let selected = null;
let quantity = 1;
let fast = false;
let spinning = false;
let spinDrops = [];
let cancelSpin = null;
let currentView = 'cases';
let inventoryLimit = 60;
let toastTimer;
const caseDialog = $('#case-dialog');
const walletDialog = $('#wallet-dialog');
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3500);
}
function skinMarkup(skin, extra = '') {
  const rarity = rarities[skin.rarity];
  return `<div class="skin-card" style="--rarity:${rarity.color}"><div class="skin-image"><img src="${skin.image}" alt="" width="512" height="384" loading="lazy" decoding="async"></div><small>${escape(skin.weapon)}</small><strong>${escape(skin.name)}</strong>${extra}</div>`;
}
function renderCatalog() {
  $('#case-grid').innerHTML = cases.map((item, index) => `<button class="case-card" data-case="${item.id}" style="--accent:${item.color}" aria-label="Открыть кейс ${item.name}, ${money(item.price)} $"><span class="case-number">${String(index + 1).padStart(2, '0')}</span>${index === 9 ? '<span class="case-badge">НОЖИ</span>' : ''}<img src="${item.image}" width="334" height="310" alt="" decoding="async" ${index < 5 ? 'fetchpriority="high"' : 'loading="lazy"'}><h3>${item.name}</h3><p>${item.subtitle}</p><span class="case-price"><em>$</em> ${money(item.price)}</span></button>`).join('');
}
function renderState() {
  try {state = store.read();} catch (error) {toast(error.message); return;}
  $('#balance').innerHTML = `<em>$</em> ${money(state.balance)}`;
  $('#inventory-count').textContent = state.inventory.length;
  $('#inventory-title-count').textContent = state.inventory.length;
  sounds.enabled = state.sound;
  $('#sound-toggle').innerHTML = icon(state.sound ? 'sound' : 'muted');
  $('#sound-toggle').setAttribute('aria-label', state.sound ? 'Отключить звук' : 'Включить звук');
  $('#sound-toggle').setAttribute('aria-pressed', String(state.sound));
  $('#recent-drops').innerHTML = state.history.length ? state.history.slice(0, 6).map(entry => {
    const skin = skinById.get(entry.skinId);
    return skinMarkup(skin, `<span class="skin-value">${money(skin.value)} <em>$</em></span>`);
  }).join('') : `<div class="empty-recent">${icon('case')}<span>Твой первый дроп ждёт. Выбери кейс выше.</span></div>`;
  if (currentView === 'inventory') renderInventory();
}
function renderInventory() {
  const shown = state.inventory.slice(0, inventoryLimit);
  $('#sell-all').disabled = !state.inventory.length;
  $('#inventory-grid').innerHTML = shown.length ? shown.map(entry => {
    const skin = skinById.get(entry.skinId);
    return skinMarkup(skin, `<button class="sell-button" data-sell="${escape(entry.id)}">Продать · ${money(skin.value)} $</button>`);
  }).join('') : `<div class="inventory-empty">${icon('grid')}<h2>Пока пусто</h2><p>Открой первый кейс — предметы появятся здесь.</p><button class="primary-button" data-view="cases">Выбрать кейс</button></div>`;
  $('#load-more').hidden = state.inventory.length <= inventoryLimit;
}
function setView(view) {
  if (!['cases', 'inventory'].includes(view)) return;
  currentView = view;
  $('#cases-view').hidden = view !== 'cases';
  $('#inventory-view').hidden = view !== 'inventory';
  document.querySelectorAll('.main-nav [data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
    button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false');
  });
  history.replaceState(null, '', '#' + view);
  renderState();
}
function showWallet() {
  if (spinning) return;
  if (caseDialog.open) caseDialog.close();
  $('#wallet-amount').value = String(store.read().balance / 100);
  $('#wallet-error').textContent = '';
  walletDialog.showModal();
  $('#wallet-amount').focus();
  $('#wallet-amount').select();
}
function caseHeader() {
  return `<button class="icon-button dialog-close" data-close="case-dialog" aria-label="Закрыть кейс">${icon('x')}</button><div class="case-heading"><img src="${selected.image}" alt="" width="334" height="310"><div><div class="eyebrow">КОЛЛЕКЦИЯ DROPZONE</div><h2>${selected.name}</h2><p>${selected.subtitle}</p></div><div class="single-cost">${money(selected.price)} <em>$ / кейс</em></div></div>`;
}
function renderCase() {
  const balance = store.read().balance;
  const cost = selected.price * quantity;
  $('#case-content').innerHTML = caseHeader() + `<div id="opening-stage" class="opening-stage"><div class="roulette-idle">${selected.drops.slice(1, 4).map(drop => skinMarkup(skinById.get(drop.skinId))).join('')}<span class="roulette-cursor"></span></div></div><div class="opening-controls"><div class="quantity-control" role="group" aria-label="Количество кейсов">${[1, 3, 5].map(count => `<button data-quantity="${count}" class="${count === quantity ? 'active' : ''}" aria-pressed="${count === quantity}">×${count}</button>`).join('')}</div><button id="open-case" class="primary-button" ${balance < cost ? 'disabled' : ''}>${icon('case')}Открыть за ${money(cost)} $</button><label class="fast-control"><input id="fast-open" type="checkbox" ${fast ? 'checked' : ''}>${icon('flash')}Быстро</label></div><div class="opening-note">${balance < cost ? '<button class="text-button" data-topup>Не хватает баланса? Пополни бесплатно</button>' : 'Предметы сохранятся в твоём инвентаре'}<span id="opening-status" role="status" aria-live="polite"></span></div><div class="contents-header"><h3>Содержимое кейса</h3><span>Шанс указан для каждого предмета</span></div><div class="case-contents">${selected.drops.map(drop => skinMarkup(skinById.get(drop.skinId), `<div class="drop-meta"><span>${money(skinById.get(drop.skinId).value)} $</span><b>${new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2}).format(drop.weight / 100)}%</b></div>`)).join('')}</div><p class="odds-note">Цены и шансы относятся к этому симулятору.</p>`;
  $('#fast-open').addEventListener('change', event => {fast = event.target.checked;});
}
function showCase(id) {
  if (spinning) return;
  selected = caseById.get(id);
  if (!selected) return;
  quantity = 1;
  spinDrops = [];
  renderCase();
  caseDialog.showModal();
  selected.drops.forEach(drop => {const image = new Image(); image.src = skinById.get(drop.skinId).image;});
}
function showResults() {
  if (!spinDrops.length || !caseDialog.open) return;
  const ids = new Set(store.read().inventory.map(item => item.id));
  const sellable = spinDrops.filter(item => ids.has(item.id));
  const total = sellable.reduce((sum, entry) => sum + skinById.get(entry.skinId).value, 0);
  $('#opening-stage').innerHTML = `<div class="result-title"><span>${icon('check')}</span><h3>${spinDrops.length === 1 ? 'Твой дроп' : 'Твои дропы'}</h3><p>Уже в инвентаре</p></div><div class="result-grid" style="--count:${spinDrops.length}">${spinDrops.map(entry => skinMarkup(skinById.get(entry.skinId), `<span class="skin-value">${money(skinById.get(entry.skinId).value)} $</span>`)).join('')}</div>`;
  $('.opening-controls').innerHTML = `<button class="primary-button" id="open-again">${icon('case')}Открыть ещё</button><button class="secondary-button" id="sell-result" ${sellable.length ? '' : 'disabled'}>${sellable.length ? `Продать за ${money(total)} $` : 'Предметы проданы'}</button>`;
  $('.opening-note').innerHTML = `<span role="status" aria-live="polite">${spinDrops.length === 1 ? 'Предмет сохранён' : 'Предметы сохранены'}</span>`;
  caseDialog.scrollTop = 0;
}
function animateRoll(drops) {
  const stage = $('#opening-stage');
  const targetIndex = 28;
  stage.innerHTML = drops.map(entry => {
    const fillers = Array.from({length: 33}, (_, index) => skinById.get(index === targetIndex ? entry.skinId : pickDrop(selected.id)));
    return `<div class="roulette-viewport"><div class="roulette-track">${fillers.map(skin => skinMarkup(skin)).join('')}</div><span class="roulette-cursor"></span></div>`;
  }).join('');
  $('.opening-controls').innerHTML = `<button class="secondary-button" id="skip-spin">Показать результат</button>`;
  $('#opening-status').textContent = 'Кейс открывается…';
  const views = [...stage.querySelectorAll('.roulette-viewport')];
  let measures = [];
  const measure = () => {measures = views.map(view => {
    const card = view.querySelector('.skin-card');
    const step = card.getBoundingClientRect().width + 10;
    return {track: view.firstElementChild, step, destination: targetIndex * step + (step - 10) / 2 - view.clientWidth / 2};
  });};
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(stage);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduced ? 0 : fast ? 1200 : 5100;
  const started = performance.now();
  let frame;
  let settleTimer;
  let lastIndex = -1;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    clearTimeout(settleTimer);
    observer.disconnect();
    cancelSpin = null;
    spinning = false;
    renderState();
    const special = drops.some(entry => ['special', 'contraband'].includes(skinById.get(entry.skinId).rarity));
    sounds.finish(special);
    showResults();
  };
  cancelSpin = finish;
  const animate = now => {
    const progress = duration ? Math.min(1, (now - started) / duration) : 1;
    const eased = 1 - Math.pow(1 - progress, 4);
    for (const {track, destination} of measures) track.style.transform = `translate3d(${-destination * eased}px,0,0)`;
    const currentIndex = Math.floor(measures[0].destination * eased / measures[0].step);
    if (currentIndex !== lastIndex && progress < 1) {sounds.tick(); lastIndex = currentIndex;}
    if (progress >= 1) {if (reduced) finish(); else settleTimer = setTimeout(finish, 450);}
    else frame = requestAnimationFrame(animate);
  };
  frame = requestAnimationFrame(animate);
}
async function startOpening() {
  if (spinning || !selected) return;
  spinning = true;
  $('#open-case').disabled = true;
  await sounds.unlock();
  try {
    const result = await store.transact(current => openCases(current, selected.id, quantity));
    spinDrops = result.drops;
    renderState();
    sounds.start();
    if (!caseDialog.open) {spinning = false; toast('Дроп сохранён в инвентаре'); return;}
    animateRoll(spinDrops);
  } catch (error) {spinning = false; renderCase(); toast(error.message);}
}
async function sell(ids) {
  try {
    const result = await store.transact(current => sellItems(current, ids));
    renderState();
    if (caseDialog.open && spinDrops.length && !spinning) showResults();
    toast(`Продано за ${money(result.value)} $`);
  } catch (error) {toast(error.message); renderState();}
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button, a.brand');
  if (!button || button.disabled) return;
  if (button.dataset.case) showCase(button.dataset.case);
  if (button.dataset.view || button.matches('a.brand')) setView(button.dataset.view || 'cases');
  if (button.hasAttribute('data-topup') || button.id === 'balance-button') showWallet();
  if (button.dataset.close) {
    if (button.dataset.close === 'case-dialog') cancelSpin?.();
    document.getElementById(button.dataset.close).close();
  }
  if (button.dataset.quantity && !spinning) {quantity = Number(button.dataset.quantity); renderCase();}
  if (button.dataset.amount) {$('#wallet-amount').value = button.dataset.amount; $('#wallet-error').textContent = '';}
  if (button.id === 'open-case') await startOpening();
  if (button.id === 'open-again' && !spinning) {spinDrops = []; renderCase();}
  if (button.id === 'skip-spin') cancelSpin?.();
  if (button.dataset.sell) await sell([button.dataset.sell]);
  if (button.id === 'sell-result') await sell(spinDrops.map(entry => entry.id));
  if (button.id === 'sell-all') await sell(store.read().inventory.map(entry => entry.id));
  if (button.id === 'load-more') {inventoryLimit += 60; renderInventory();}
  if (button.id === 'sound-toggle') {
    try {
      await store.transact(current => ({state: {...current, sound: !current.sound}}));
      renderState();
      if (sounds.enabled) {await sounds.unlock(); sounds.tick();}
    } catch (error) {toast(error.message);}
  }
});
$('#wallet-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const amount = parseBalance($('#wallet-amount').value);
    await store.transact(current => ({state: {...current, balance: amount}}));
    renderState();
    walletDialog.close();
    toast('Баланс обновлён. Удачного дропа!');
  } catch (error) {$('#wallet-error').textContent = error.message;} finally {button.disabled = false;}
});
caseDialog.addEventListener('cancel', () => cancelSpin?.());
caseDialog.addEventListener('close', () => cancelSpin?.());
for (const dialog of [walletDialog, caseDialog]) dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {if (dialog === caseDialog) cancelSpin?.(); dialog.close();}
});
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY || event.key === null) {
    renderState();
    if (caseDialog.open && !spinning) {if (spinDrops.length) showResults(); else renderCase();}
  }
});
document.addEventListener('visibilitychange', () => {if (document.hidden && spinning) cancelSpin?.();});
renderCatalog();
setView(location.hash === '#inventory' ? 'inventory' : 'cases');
if (!store.persistent) toast('Хранилище недоступно. Прогресс сохранится до закрытия вкладки.');
