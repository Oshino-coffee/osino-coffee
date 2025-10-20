

const $ = sel => document.querySelector(sel);
const fmt = n => '¥' + (n||0).toLocaleString('ja-JP');
const nowIso = () => new Date().toISOString();
function nextOrderId(seq){ return String(seq).padStart(4,'0'); }

const idb = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('mogi-pos', 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        db.createObjectStore('items', { keyPath: 'id' });
        db.createObjectStore('orders', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = e => { idb.db = e.target.result; resolve(); };
      req.onerror = e => reject(e);
    });
  },
  tx(store, mode) { return idb.db.transaction(store, mode).objectStore(store); },
  get(store, key) { return new Promise((res, rej)=>{ const r=idb.tx(store,'readonly').get(key); r.onsuccess=()=>res(r.result); r.onerror=rej; }); },
  getAll(store) { return new Promise((res, rej)=>{ const r=idb.tx(store,'readonly').getAll(); r.onsuccess=()=>res(r.result); r.onerror=rej; }); },
  put(store, val) { return new Promise((res, rej)=>{ const r=idb.tx(store,'readwrite').put(val); r.onsuccess=()=>res(); r.onerror=rej; }); },
  del(store, key) { return new Promise((res, rej)=>{ const r=idb.tx(store,'readwrite').delete(key); r.onsuccess=()=>res(); r.onerror=rej; }); },
};

const DEFAULT_ITEMS = [
  { id:'drip',   name:'ドリップコーヒー', price:300, category:'ドリンク', active:true, stock:null },
  { id:'tea',    name:'紅茶',             price:300, category:'ドリンク', active:true, stock:null },
  { id:'affo',   name:'アフォガード',     price:450, category:'スイーツ', active:true, stock:null },
  { id:'latte',  name:'ラテ',             price:380, category:'ドリンク', active:true, stock:null },
];

const state = {
  items: [], editingOrder:null,
  cart: [],
  orderSeq: 1,
};

(async function init(){
  await idb.open();
  const existing = await idb.getAll('items');
  if (!existing || existing.length === 0) {
    for (const it of DEFAULT_ITEMS) await idb.put('items', it);
  }
  state.items = await idb.getAll('items');
  const meta = await idb.get('meta','orderSeq');
  state.orderSeq = (meta && meta.value) ? meta.value : 1;

  renderItems();
  renderCart();
  updateOrderNo();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js');
  }

  $('#exact').addEventListener('click', ()=> { $('#cashInput').value = calcTotal(); updateChange(); });
  document.querySelectorAll('[data-cash]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const inc = parseInt(btn.dataset.cash,10);
      const v = parseInt($('#cashInput').value||0,10);
      $('#cashInput').value = (v+inc);
      updateChange();
    });
  });
  $('#cashInput').addEventListener('input', updateChange);
  $('#checkout').addEventListener('click', onCheckout);
  $('#clearCart').addEventListener('click', ()=>{ state.cart=[]; renderCart(); });

  $('#openManage').addEventListener('click', openManage);
  $('#openHistory').addEventListener('click', openHistory);
  $('#exportCsv').addEventListener('click', exportCsv);
})();

function renderItems(){
  const wrap = $('#itemsGrid');
  wrap.innerHTML = '';
  state.items
    .filter(it=> it.active)
    .forEach(it=>{
      const btn = document.createElement('button');
      btn.className = 'item' + (it.stock===0 ? ' soldout' : '');
      btn.textContent = `${it.name}\n${fmt(it.price)}`;
      btn.addEventListener('click', ()=> addToCart(it));
      wrap.appendChild(btn);
    });
}

function addToCart(it){
  if (it.stock===0) return;
  const line = state.cart.find(l=> l.id===it.id);
  if (line) line.qty++;
  else state.cart.push({ id:it.id, name:it.name, price:it.price, qty:1 });
  renderCart();
}
function changeQty(id,delta){
  const line = state.cart.find(l=> l.id===id);
  if (!line) return;
  line.qty += delta;
  if (line.qty<=0) state.cart = state.cart.filter(l=>l.id!==id);
  renderCart();
}
function lineTotal(l){ return l.price * l.qty; }
function calcSubtotal(){ return state.cart.reduce((a,l)=> a+lineTotal(l), 0); }
function calcTotal(){ return calcSubtotal(); }
function renderCart(){
  const tbody = $('#cartTable tbody');
  tbody.innerHTML='';
  for (const l of state.cart) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${l.name}</td>
      <td class="right">${fmt(l.price)}</td>
      <td class="qty">
        <button class="qtybtn" aria-label="minus">-</button>
        <span style="display:inline-block; width:36px; text-align:center;">${l.qty}</span>
        <button class="qtybtn" aria-label="plus">+</button>
      </td>
      <td class="right">${fmt(lineTotal(l))}</td>
      <td class="right"><button class="qtybtn" aria-label="remove">×</button></td>
    `;
    const [minus, plus] = tr.querySelectorAll('.qtybtn'); // 修正：正しく minus/plus を取得
    minus.addEventListener('click', ()=> changeQty(l.id,-1));
    plus.addEventListener('click', ()=> changeQty(l.id,+1));
    tr.querySelector('[aria-label="remove"]').addEventListener('click', ()=>{ state.cart = state.cart.filter(x=>x.id!==l.id); renderCart(); });
    tbody.appendChild(tr);
  }
  $('#subtotal').textContent = fmt(calcSubtotal());
  $('#discount').textContent = fmt(0);
  $('#total').textContent = fmt(calcTotal());
  updateChange();
}
function updateOrderNo(){ $('#orderNo').textContent = nextOrderId(state.orderSeq); }
function updateChange(){
  const cash = parseInt($('#cashInput').value||0,10);
  const chg = Math.max(0, cash - calcTotal());
  $('#change').textContent = fmt(chg);
  $('#change').className = chg>=0 ? 'right good' : 'right bad';
}


async function onCheckout(){
  const lines = state.cart.map(l=> ({ id:l.id, name:l.name, unit:l.price, qty:l.qty }));
  const total = lines.reduce((s,l)=> s + l.unit*l.qty, 0);
  if (lines.length===0) { alert('カートが空です'); return; }
  const cash = parseInt($('#cashInput').value||0,10);
  if (cash < total) { alert('受取金額が不足しています'); return; }
  // meta for order sequence
  const seq = (await idb.get('meta','seq')) || { key:'seq', value:1 };
  let order;
  if (state.editingOrder){
    // 上書き更新：id/orderNoはそのまま
    order = await idb.get('orders', state.editingOrder);
    if (!order) { alert('編集対象の伝票が見つかりませんでした'); return; }
    order.lines = lines;
    order.total = total;
    order.ts = nowIso();
    order.edited = true;
    await idb.put('orders', order);
    state.editingOrder = null;
  } else {
    const id = crypto.randomUUID();
    const orderNo = nextOrderId(seq.value);
    order = { id, orderNo, ts: nowIso(), lines, total };
    await idb.put('orders', order);
    seq.value += 1;
    await idb.put('meta', seq);
  }
  // 数を消費（管理がある場合のみ）
  for (const l of lines){
    const item = state.items.find(x=> x.id===l.id);
    if (item && typeof item.stock === 'number' && item.stock!==null){
      item.stock = Math.max(0, (item.stock||0) - l.qty);
      await idb.put('items', item);
    }
  }
  state.cart = [];
  $('#cashInput').value='';
  renderItems();
  renderCart();
  alert('会計を反映しました');
}



function openManage(){
  const dlg = $('#manageDlg');
  buildManageList();
  dlg.showModal();
  
  // タブレットでの自動フォーカスによるキーボード起動を抑制
  if ('ontouchstart' in window) { setTimeout(()=>{ const ae=document.activeElement; if (ae && ae.tagName==='INPUT') ae.blur(); }, 0); }
$('#addItemBtn').onclick = addItemFormRow;
  $('#saveAllItems').onclick = async ()=>{
    const rows = Array.from(document.querySelectorAll('#manageList .form-row'));
    for (const r of rows) {
      const { it, name, price } = r._bind || {};
      if (!it) continue;
      it.name = (name.value||'').trim() || it.name;
      it.price = Math.max(0, parseInt(price.value||0,10));
      it.active = true; // アクティブ表記は廃止、常に販売可能として扱う
      await idb.put('items', it);
    }
    state.items = await idb.getAll('items');
    renderItems();
    alert('保存しました');
  };
  $('#closeManage').onclick = ()=> dlg.close();
}

function buildManageList(){
  const box = $('#manageList');
  box.innerHTML = '';
  state.items.forEach(it=> box.appendChild(itemRow(it)));
}


function itemRow(it){
  const row = document.createElement('div');
  row.className='form-row';
  row.innerHTML = `
    <input value="${it.name}" aria-label="name">
    <input type="number" value="${it.price}" aria-label="price">
    <button class="danger" data-del>削除</button>
  `;
  const [name, price, delBtn] = row.querySelectorAll('input,input,button');
  row._bind = { it, name, price };
  delBtn.addEventListener('click', async ()=>{
    if (!confirm(`商品「${it.name}」を削除します。よろしいですか？`)) return;
    // DBから削除
    await idb.del('items', it.id);
    // stateから削除
    state.items = (await idb.getAll('items'));
    row.remove();
    renderItems();
  });
  return row;
}
function addItemFormRow(){
  const nid = 'i-' + Math.random().toString(36).slice(2,8);
  const it = { id:nid, name:'新商品', price:0, category:'', active:true, stock:null };
  state.items.push(it);
  $('#manageList').appendChild(itemRow(it));
}

async function openHistory(){
  const dlg = $('#historyDlg');
  await renderHistory();
  dlg.showModal();
  $('#closeHistory').onclick = ()=> dlg.close();
}

async function renderHistory(){
  const orders = (await idb.getAll('orders')).sort((a,b)=> a.ts<b.ts?1:-1);
  const t = orders.reduce((s,o)=> s+o.total, 0);
  $('#historySummary').textContent = `件数：${orders.length}　通算売上：${fmt(t)}`;
  const body = $('#historyBody');
  body.innerHTML = '';
  for (const o of orders) {
    const tr = document.createElement('tr');
    const detail = o.lines.map(l=> `${l.name}×${l.qty}`).join('、');
    const mark = o.edited ? ' ✅' : '';
    tr.innerHTML = `<td>${new Date(o.ts).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</td>
      <td>${o.orderNo}${mark}</td><td class="right">${fmt(o.total)}</td><td>${detail}</td>
      <td class="rowbtns">
        <button data-act="edit">編集</button>
      </td>`;
    // Inline editor row
    const editor = document.createElement('tr');
    editor.style.display = 'none';
    const editorTd = document.createElement('td');
    editorTd.colSpan = 5;
    editor.appendChild(editorTd);
    const buildEditor = ()=>{
      const wrap = document.createElement('div');
      wrap.style.padding = '8px';
      wrap.style.background = '#fafafa';
      wrap.style.border = '1px solid #eee';
      // Build editable lines
      o.lines = o.lines || [];
      const list = document.createElement('div');
      for (let i=0;i<o.lines.length;i++){
        const l = o.lines[i];
        const row = document.createElement('div');
        row.style.display='grid';
        row.style.gridTemplateColumns='2fr 1fr 1fr auto';
        row.style.gap='8px';
        row.style.margin='6px 0';
        row.innerHTML = `
          <div>${l.name}</div>
          <input type="number" min="0" value="${l.unit}" aria-label="unit">
          <input type="number" min="0" value="${l.qty}" aria-label="qty">
          <button data-del>削除</button>
        `;
        const [unit, qty, delBtn] = row.querySelectorAll('input, input, button');
        delBtn.addEventListener('click', ()=>{ row.remove(); });
        row._bind = { l, unit, qty };
        list.appendChild(row);
      }
      wrap.appendChild(list);
      const ctrl = document.createElement('div');
      ctrl.style.display='flex'; ctrl.style.gap='8px'; ctrl.style.justifyContent='flex-end'; ctrl.style.marginTop='8px';
      const saveBtn = document.createElement('button'); saveBtn.textContent='保存';
      const cancelBtn = document.createElement('button'); cancelBtn.textContent='キャンセル';
      ctrl.appendChild(cancelBtn); ctrl.appendChild(saveBtn);
      wrap.appendChild(ctrl);
      // Handlers
      cancelBtn.addEventListener('click', ()=>{
        editor.style.display='none';
      });
      saveBtn.addEventListener('click', async ()=>{
        // Collect lines
        const rows = Array.from(list.children);
        const newLines = [];
        let total = 0;
        for (const r of rows){
          const { l, unit, qty } = r._bind || {};
          const u = Math.max(0, parseInt(unit.value||0,10));
          const q = Math.max(0, parseInt(qty.value||0,10));
          if (q===0) continue;
          newLines.push({ id:l.id, name:l.name, unit:u, qty:q });
          total += u*q;
        }
        o.lines = newLines;
        o.total = total;
        // o.ts は会計確定時刻のまま維持
        o.edited = true;
        await idb.put('orders', o); // 同じ id で上書き（旧伝票は増えない）
        await renderHistory();
      });
      return wrap;
    };
    tr.querySelector('[data-act="edit"]').addEventListener('click', ()=>{
      editorTd.innerHTML = '';
      editorTd.appendChild(buildEditor());
      editor.style.display = editor.style.display==='none' ? '' : 'none';
    });
    body.appendChild(tr);
    body.appendChild(editor);
  }
}


async function exportCsv(){
  const orders = await idb.getAll('orders');
  const rows = [['time','orderNo','item','qty','unit','line','total','cash','change']];
  for (const o of orders) {
    for (const l of o.lines) {
      rows.push([o.ts, o.orderNo, l.name, l.qty, l.unit, l.line, o.total, o.cash, o.change]);
    }
  }
  const csv = rows.map(r=> r.map(x=>{
    const s = (x??'').toString();
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  }).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `sales-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function openStats(){
  const dlg = $('#statsDlg');
  await renderStats();
  dlg.showModal();
  $('#closeStats').onclick = ()=> dlg.close();
}
async function renderStats(){
  const orders = await idb.getAll('orders');
  const map = new Map();
  let tq=0, tt=0;
  for (const o of orders){
    for (const l of (o.lines||[])){
      const k = l.id + '|' + l.name;
      const cur = map.get(k) || { name:l.name, qty:0, sales:0 };
      cur.qty += l.qty;
      cur.sales += l.qty * l.unit;
      map.set(k, cur);
      tq += l.qty; tt += l.qty * l.unit;
    }
  }
  const arr = Array.from(map.values()).sort((a,b)=> b.qty - a.qty);
  const body = $('#statsBody'); body.innerHTML='';
  for (const r of arr){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.name}</td><td class="right">${r.qty}</td><td class="right">${fmt(r.sales)}</td>`;
    body.appendChild(tr);
  }
  $('#statsSummary').textContent = `合計数量：${tq}　合計売上：${fmt(tt)}`;
}

// Wire header button
$('#openStats').addEventListener('click', openStats);




// 追加: data-delボタンにテキスト「削除」を強制（キャッシュやスタイルの不整合対策）
document.querySelectorAll('button[data-del]').forEach(b=>{
  if (!b.textContent.trim()) b.textContent = '削除';
});

