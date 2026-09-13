// ===== 功能：聊天默认字卡 + 其他互动功能字卡 =====
// 数据来自星言简易版默认通用字卡；可开关；分类浏览（主字卡/颜文字/emoji）；
// 开启后联系人回复按「整体概率 + 分类占比」混入默认字卡
// v3.16.x：功能触发字卡（摸鱼/吃饭/经期/喝水/花园/同频/伸手/此间/房间/存钱罐/
// 漂流瓶/互动回应）从「聊天默认字卡」页拆出，独立成「其他互动功能字卡」页——
// 这些字卡不是聊天通用回复，是触发对应功能时联系人才会使用。
(function () {
  const list = document.getElementById('dc-list');
  const tabsWrap = document.getElementById('dc-tabs');
  const enabledEl = document.getElementById('dc-enabled');
  if (!list || !tabsWrap || !enabledEl) return;

  const uid = window.activePrefix();
  const ls = window.activeStore();
  // v3.6.x：轻提示（复用 cc-toast 风格）
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }
  function toastCard(txt, off) {
    const s = String(txt == null ? '' : txt);
    toast((off ? '已关闭：' : '已开启：') + (s.length > 18 ? s.slice(0, 18) + '…' : s));
  }
  // ---- 开关/概率读取（store 参数化）----
  // 所有 dc-* 键都按桌面（联系人命名空间）独立保存；顶层 API 绑 activeStore（当前
  // 桌面），群聊等跨桌面场景用 defaultCardApiFor(目标桌面 store) 按成员自己的桌面读。
  // 默认值（对应星言 defaultCommonOverallProb=30, probs 各30）
  function apiFor(st) {
    const gE = function () { const v = st.get('dc-enabled'); return v === null ? true : v === '1'; };
    const gO = function () { const v = st.get('dc-overall'); return v === null ? 30 : Number(v); };
    // v3.28.x：场景概率——dc-overall-<k>（聊天/信箱/朋友圈）未设置时回退整体概率 dc-overall；
    //   朋友圈历史行为是「始终混入」（100），由消费方（feed.js）在键缺失时按 100 兜底
    const gOS = function (k) { const v = st.get('dc-overall-' + k); return v === null ? gO() : Number(v); };
    const gP = function (k) { const v = st.get('dc-prob-' + k); return v === null ? 25 : Number(v); };
    const gU = function (k) { const v = st.get('dc-use-' + k); return v === null ? true : v === '1'; };
    const gC = function (k) { const v = st.get('dc-cat-' + k); return v === null ? true : v === '1'; };
    const gOff = function (cat, c) { return st.get('dc-off-' + cat + ':' + c) === '1'; };
    return {
      enabled: gE,
      overall: gO,
      overallFor: gOS,
      prob: gP,
      use: gU,
      cat: gC,
      isOff: gOff,
      // 不依赖 this（箭头闭包）——调用方解构单个方法也不会丢上下文
      cfg: function () {
        return { enabled: gE(), overall: gO(), overallFor: gOS, probs: { main: gP('main'), kaomoji: gP('kaomoji'), emoji: gP('emoji'), touch: gP('touch') } };
      }
    };
  }
  const api = apiFor(ls);
  function getEnabled() { return api.enabled(); }
  function getOverall() { return api.overall(); }
  function getProb(k) { return api.prob(k); }
  // v3.7.x：场景开关——默认字卡可分别用于 聊天 / 信箱 / 朋友圈（默认全开）
  //   存 localStorage 键：dc-use-chat / dc-use-mail / dc-use-feed（'1' 开启）
  function getUse(k) { return api.use(k); }
  function setUse(k, on) { ls.set('dc-use-' + k, on ? '1' : '0'); }
  window.defaultCardUse = function (k) { return getUse(k); };
  // v3.8.x：分类开关——主字卡 / 颜文字 / emoji / 拍一拍 可分别开启/关闭（默认全开）
  //   存 localStorage 键：dc-cat-<k>（'1' 开启）；关闭后该分类不参与聊天混入/信箱混入/
  //   朋友圈补池/拍一拍抽取
  function getCat(k) { return api.cat(k); }
  function setCat(k, on) { ls.set('dc-cat-' + k, on ? '1' : '0'); }
  window.defaultCardCat = function (k) { return getCat(k); };
  window.defaultCardCfg = function () { return api.cfg(); };
  // v3.12.x：按指定桌面的 store 读一套开关（供群聊按成员所在桌面取：
  // 某成员桌面关闭【聊天使用】→ 单聊和群聊里这个成员都不再使用默认字卡）
  window.defaultCardApiFor = apiFor;

  // 数据（提取自星言 08_default_cards_data.js）
  const DATA = (window.DEFAULT_CARD_DATA) || { main: [], kaomoji: [], emoji: [] };
  // #319 防未成年人二级验证锁：锁定时系统预设字卡整体视为不存在（字卡库/回复池/词典拼字/
  //   各功能同源池全部取空），用户自建字卡不受影响——card-lock.js 先于本文件加载。
  const LOCKED = () => !(window.cardLockOpen && window.cardLockOpen());

  // ================= v3.28.x #301：词典自建词条（词典 tab 内自由新增/删除） =================
  // 存储：全局命名空间 xy-home-v2:dict-custom-quotes / dict-custom-words（JSON 数组）——
  // 词典是语言资源，不随联系人桌面隔离。语录并入「语录·自建」分组（进拼字抽句池），
  // 词并入「词库·自建」分组（进切词词典）；内置词条不可删（可单卡关闭），自建词条可删。
  // v3.28.x #301 v3：词典扩展——DEFAULT_CARD_DATA.dict_ext（dict-ext-data.js，jieba 高频
  // ~3.8 万词按字数分组）并入词典分类；拼接规则＝组名前缀：语录* 进抽句池、词库* 进切词。
  const DICT_CUST_QKEY = 'dict-custom-quotes';
  const DICT_CUST_WKEY = 'dict-custom-words';
  // 页面加载时的内置词典快照（基础 dict + 扩展 dict_ext）：每次并组都从它重建，避免重复追加
  const PRESET_DICT = (DATA.dict || []).concat(DATA.dict_ext || []).map(g => [g[0], (g[1] || []).slice()]);
  function dictCustRead(key) {
    try {
      const raw = window.xyStore('xy-home-v2').get(key);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(x => typeof x === 'string' && x) : [];
    } catch (e) { return []; }
  }
  function dictCustWrite(key, arr) {
    try { window.xyStore('xy-home-v2').set(key, JSON.stringify(arr)); } catch (e) {}
  }
  // 内置（基础+扩展）+自建并成 DATA.dict（重复调用安全：每次从 PRESET_DICT 重建）；
  // 同时刷新 window.__dictCustomSet（列表「自建」徽标依据，makeNode 读）
  function mergeDictCustom() {
    try {
      const qs = dictCustRead(DICT_CUST_QKEY);
      const ws = dictCustRead(DICT_CUST_WKEY);
      const base = PRESET_DICT.map(g => [g[0], g[1].slice()]);
      // v3.33.x：取消独立「词库·自建」分组（用户要求删掉）——自建词并入内置「词库」组
      //（组名仍以「词库」开头，切词词典消费不受影响）；「自建」徽标仍由 __dictCustomSet 标注。
      // 语录/词库兜底组仅在有内容时才创建，避免空分组占位。
      const gq = base.find(g => g[0] === '语录');
      if (gq) gq[1] = gq[1].concat(qs);
      else if (qs.length) base.push(['语录·自建', qs.slice()]);
      const gw = base.find(g => g[0].indexOf('词库') === 0);
      if (gw) gw[1] = gw[1].concat(ws);
      else if (ws.length) base.push(['词库·自建', ws.slice()]);
      DATA.dict = base;
      window.__dictCustomSet = new Set(qs.concat(ws));
    } catch (e) {}
  }
  mergeDictCustom();
  function dictCustomAdd(kind, text) {
    const v = String(text == null ? '' : text).replace(/\s+/g, '');
    if (!v) return { ok: false, msg: '内容为空，先输入再保存' };
    if (v.indexOf('data:') === 0 || v.indexOf('|||') >= 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(v))) return { ok: false, msg: '该内容不能作为词典词条' }; // FIX 2026-09-13 #394 媒体池令牌串不得进词典
    const pref = kind === 'quote' ? '语录' : '词库';
    const dupPreset = PRESET_DICT.some(g => g[0].indexOf(pref) === 0 && g[1].indexOf(v) >= 0);
    if (dupPreset) return { ok: false, msg: '内置词典已有这条' };
    const key = kind === 'quote' ? DICT_CUST_QKEY : DICT_CUST_WKEY;
    const arr = dictCustRead(key);
    if (arr.indexOf(v) >= 0) return { ok: false, msg: '已存在这条自建词条' };
    arr.push(v);
    dictCustWrite(key, arr);
    mergeDictCustom();
    try { if (window.quoteSpellResetDict) window.quoteSpellResetDict(); } catch (e) {}
    return { ok: true, msg: (kind === 'quote' ? '已存为语录：' : '已存为词：') + v };
  }
  function dictCustomRemove(text) {
    const v = String(text == null ? '' : text).replace(/\s+/g, '');
    if (!v) return false;
    let n = 0;
    [DICT_CUST_QKEY, DICT_CUST_WKEY].forEach(k => {
      const arr = dictCustRead(k);
      const i = arr.indexOf(v);
      if (i >= 0) { arr.splice(i, 1); dictCustWrite(k, arr); n++; }
    });
    if (n) {
      mergeDictCustom();
      try { if (window.quoteSpellResetDict) window.quoteSpellResetDict(); } catch (e) {}
    }
    return n > 0;
  }

  // v3.16.x：字卡库入口角标数量动态化——template.html 里写死的「3260」早已过期
  //（主字卡现 4621，全库含互动回应/摸鱼/吃什么/经期/喝水/花园等同源功能池共 5800+），
  // 改为按 DEFAULT_CARD_DATA 全部分类实时合计；后续新增分类角标自动跟上不再写死。
  // v3.16.x：拆页后「聊天默认字卡」角标只统计四大基础分类；
  // 「其他互动功能字卡」入口角标统计全部功能分类（fish/eat/period/water/garden/
  // sync/reach/cjian/room/piggy/drift/interact）。
  // deskcheck（联系人跨桌面查岗）独立成系统预设字卡里的单独入口，见 page-deskcheck。
  const FUNC_KEYS = ['fish', 'eat', 'period', 'water', 'garden', 'sync', 'reach', 'cjian', 'room', 'piggy', 'drift', 'interact', 'music'];
  // 词典（dict）已独立成大分类（page-dict-cards，见 dictView），不再并入默认聊天字卡——
  // BASE_KEYS 只含默认字卡四大分类；词典数据仅由词典独立页与词典拼字（quote-spell.js）消费。
  const BASE_KEYS = ['main', 'kaomoji', 'emoji', 'touch'];
  // v3.26.x：搜索跨全库（聊天默认字卡页 + 其他互动功能字卡页全部 tab），
  // 不再局限于当前 tab——用户搜「轻轻抵着」在任意页面都能找到经期温柔动作字卡。
  const ALL_KEYS = BASE_KEYS.concat(FUNC_KEYS);
  // 跨 tab 搜索结果用「[tab名] 分组名」标注来源：从 dc/fc tabs 读 data-type → 显示名
  const TAB_LABELS = (function () {
    const m = {};
    ['dc-tabs', 'fc-tabs'].forEach(function (id) {
      const w = document.getElementById(id);
      if (!w) return;
      w.querySelectorAll('.cc-tab[data-type]').forEach(function (t) { m[t.dataset.type] = t.textContent.trim(); });
    });
    return m;
  })();
  function tabLabel(k) { return TAB_LABELS[k] || k; }
  function sumKeys(keys) {
    let n = 0;
    keys.forEach(k => { (DATA[k] || []).forEach(g => { n += Array.isArray(g[1]) ? g[1].length : 0; }); });
    return n;
  }
  function refreshLibCount() {
    const el = document.getElementById('dc-lib-count');
    if (el) el.textContent = String(sumKeys(BASE_KEYS));
    const del = document.getElementById('dc-dict-count');
    if (del) del.textContent = String(sumKeys(['dict']));
    const fel = document.getElementById('fc-lib-count');
    if (fel) fel.textContent = String(sumKeys(FUNC_KEYS));
    const dkel = document.getElementById('dk-lib-count');
    if (dkel) dkel.textContent = String(sumKeys(['deskcheck']));
  }
  refreshLibCount();

  // v3.6.x：单卡开关——系统预设字卡可逐张开启/关闭使用
  //   存 localStorage 键：dc-off-<分类>:<字卡内容>，关闭为 '1'
  function isCardOff(cat, c) { return api.isOff(cat, c); }
  function setCardOff(cat, c, off) { ls.set('dc-off-' + cat + ':' + c, off ? '1' : '0'); }
  // v3.6.x：暴露单卡开关查询（供 chat.js 字卡池兜底过滤：自定义字卡为空时
  //   系统字卡补池也必须跳过用户已关闭的字卡）
  window.isDefaultCardOff = function (cat, c) { return isCardOff(cat, c); };

  // ---- 页面 UI ----
  let cur = 'main';
  let q = '';
  enabledEl.checked = getEnabled();
  enabledEl.addEventListener('change', () => {
    ls.set('dc-enabled', enabledEl.checked ? '1' : '0');
    // v3.6.x：总开关也弹轻提示（与单卡开关一致）
    toast(enabledEl.checked ? '已开启：使用系统预设字卡' : '已关闭：使用系统预设字卡');
  });
  // v3.7.x：场景开关绑定——聊天 / 信箱 / 朋友圈 分别控制默认字卡的使用
  [['chat', '聊天'], ['mail', '信箱'], ['feed', '朋友圈']].forEach(([k, label]) => {
    const el = document.getElementById('dc-use-' + k);
    if (!el) return;
    el.checked = getUse(k);
    el.addEventListener('change', () => {
      setUse(k, el.checked);
      toast((el.checked ? '已开启' : '已关闭') + '：默认字卡' + label + '使用');
    });
  });
  // v3.12.x：场景开关下方小字说明——dc-* 键按桌面（联系人）独立保存；
  // 某联系人桌面关闭【聊天使用】，单聊和群聊里这个联系人都不会再使用默认字卡
  (function () {
    const row = document.getElementById('dc-use-feed');
    if (!row) return;
    const grp = row.closest('.set-group');
    if (!grp || document.getElementById('dc-scope-note')) return;
    const note = document.createElement('div');
    note.id = 'dc-scope-note';
    note.style.cssText = 'margin:8px 12px 10px;font-size:11px;line-height:1.6;color:#999;';
    note.textContent = '以上开关按当前桌面对应的联系人独立保存：当当前桌面联系人关闭【聊天使用】，聊天和群聊里这个联系人也无法使用默认字卡（其他联系人不受影响）。';
    grp.parentNode.insertBefore(note, grp.nextSibling);
  })();
  // v3.8.x：分类开关绑定——主字卡 / 颜文字 / emoji / 拍一拍 分别控制默认字卡分类使用
  // （词典已独立成大分类，不再归属默认字卡分类；词典拼字启用由词典独立页/回复设置控制）
  [['main', '主字卡'], ['kaomoji', '颜文字'], ['emoji', 'emoji'], ['touch', '拍一拍']].forEach(([k, label]) => {
    const el = document.getElementById('dc-cat-' + k);
    if (!el) return;
    el.checked = getCat(k);
    el.addEventListener('change', () => {
      setCat(k, el.checked);
      toast((el.checked ? '已开启' : '已关闭') + '：默认字卡' + label + '使用');
    });
  });
  // v3.28.x：使用概率绑定——聊天 / 信箱 / 朋友圈 三场景各自可调默认字卡出现概率
  //   存键 dc-overall-<k>（未设置=该场景历史默认：聊天/信箱 30，朋友圈 100 始终混入）
  const DC_OVERALL_DEF = { chat: 30, mail: 30, feed: 100 };
  function dcOverallVal(k) { const v = ls.get('dc-overall-' + k); return v === null ? DC_OVERALL_DEF[k] : Number(v); }
  function dcOverallSet(k, nv) { ls.set('dc-overall-' + k, String(nv)); }
  [['chat', '聊天'], ['mail', '写信'], ['feed', '朋友圈']].forEach(([k, label]) => {
    const box = document.getElementById('dc-overall-' + k);
    const valEl = document.getElementById('dc-overall-' + k + '-val');
    if (!box || !valEl) return;
    valEl.value = String(dcOverallVal(k));
    box.querySelector('.stp-min').addEventListener('click', () => {
      const nv = Math.max(0, (parseInt(valEl.value, 10) || 0) - 5);
      valEl.value = String(nv); dcOverallSet(k, nv);
      toast('默认字卡' + label + '使用概率：' + nv + '%');
    });
    box.querySelector('.stp-max').addEventListener('click', () => {
      const nv = Math.min(100, (parseInt(valEl.value, 10) || 0) + 5);
      valEl.value = String(nv); dcOverallSet(k, nv);
      toast('默认字卡' + label + '使用概率：' + nv + '%');
    });
  });
  // v3.33.x：分类占比绑定——默认字卡命中后四大分类按占比分配（四类合计 100%）。
  //   存键 dc-prob-<k>（未设置=等权 25，行为与旧权重等价）；改动即生效，
  //   抽取按相对权重归一（drawCards 用权重滚动），单独调一档不强制影响其它档。
  function dcProbSet(k, nv) { ls.set('dc-prob-' + k, String(nv)); }
  [['main', '主字卡'], ['kaomoji', '颜文字'], ['emoji', 'emoji'], ['touch', '拍一拍']].forEach(([k, label]) => {
    const box = document.getElementById('dc-prob-' + k);
    const valEl = document.getElementById('dc-prob-' + k + '-val');
    if (!box || !valEl) return;
    valEl.value = String(getProb(k));
    box.querySelector('.stp-min').addEventListener('click', () => {
      const nv = Math.max(0, (parseInt(valEl.value, 10) || 0) - 5);
      valEl.value = String(nv); dcProbSet(k, nv);
      toast('默认字卡' + label + '占比：' + nv + '%');
    });
    box.querySelector('.stp-max').addEventListener('click', () => {
      const nv = Math.min(100, (parseInt(valEl.value, 10) || 0) + 5);
      valEl.value = String(nv); dcProbSet(k, nv);
      toast('默认字卡' + label + '占比：' + nv + '%');
    });
  });
  // v3.32.x：功能字卡使用概率绑定——其他互动功能字卡页（含查岗页）每个分类一个
  //   stepper，存键 dcf-<分类>（per-cid，随桌面命名空间）。未设置时回退该分类的
  //   历史默认值（= 改版前代码里写死的触发概率），行为不变；设 0 即该分类字卡
  //   触发后不再随机出现。消费方统一走 window.dcfGet(分类) 读。
  const DCF_DEF = { fish: 35, eat: 35, period: 25, water: 35, garden: 40, sync: 60, reach: 55, cjian: 100, room: 100, piggy: 100, drift: 100, interact: 100, music: 100, deskcheck: 50 };
  // v3.33.x：功能字卡总开关——【其他互动功能字卡】可整体开启/关闭（dcf-enabled 键，默认开启）。
  //   开启/关闭分别存 '1'/'0'；关闭后 FUNC_KEYS 各功能触发字卡都不再随机出现（dcfVal 返回 0），
  //   各分类概率（dcf-prob-*）仍保留。独立入口「联系人跨桌面查岗」(deskcheck) 不受此开关约束。
  function dcfEnabled() {
    try { const v = window.activeStore().get('dcf-enabled'); return v === null ? true : v === '1'; } catch (e) { return true; }
  }
  function dcfEnableSet(on) { try { window.activeStore().set('dcf-enabled', on ? '1' : '0'); } catch (e) {} }
  window.dcfEnabled = dcfEnabled;
  function dcfVal(k) {
    if (FUNC_KEYS.indexOf(k) >= 0 && !dcfEnabled()) return 0;
    if (!(k in DCF_DEF)) return 100;
    try { const v = window.activeStore().get('dcf-' + k); if (v !== null && v !== undefined) { const n = Number(v); if (!isNaN(n)) return Math.max(0, Math.min(100, n)); } } catch (e) {}
    return DCF_DEF[k];
  }
  window.dcfGet = dcfVal;
  // 总开关 UI 绑定：存在则同步勾选状态、监听变更写键并轻提示
  (function () {
    const el = document.getElementById('dcf-enabled');
    if (!el) return;
    el.checked = dcfEnabled();
    el.addEventListener('change', () => {
      dcfEnableSet(el.checked);
      toast((el.checked ? '已开启' : '已关闭') + '：使用其他互动功能字卡');
    });
  })();
  function bindDcfProb() {
    Object.keys(DCF_DEF).forEach((k) => {
      const box = document.getElementById('dcf-prob-' + k);
      const valEl = document.getElementById('dcf-prob-' + k + '-val');
      if (!box || !valEl) return;
      valEl.value = String(dcfVal(k));
      box.querySelector('.stp-min').addEventListener('click', () => {
        const nv = Math.max(0, (parseInt(valEl.value, 10) || 0) - 5);
        valEl.value = String(nv);
        try { window.activeStore().set('dcf-' + k, String(nv)); } catch (e) {}
        toast('字卡使用概率（' + k + '）：' + nv + '%');
      });
      box.querySelector('.stp-max').addEventListener('click', () => {
        const nv = Math.min(100, (parseInt(valEl.value, 10) || 0) + 5);
        valEl.value = String(nv);
        try { window.activeStore().set('dcf-' + k, String(nv)); } catch (e) {}
        toast('字卡使用概率（' + k + '）：' + nv + '%');
      });
    });
  }
  bindDcfProb();
  // v3.26.x：小键写日志异步合并（idb.js mochi-wrj-heal）把 dc-* 键修正后，重同步
  // 总开关/场景开关/分类开关的 UI——修荣耀 Edge 杀进程回滚 LS 后「开关退出重进变回去」
  // 且已打开的设置页仍显示旧值的问题
  document.addEventListener('mochi-wrj-heal', function () {
    try {
      enabledEl.checked = getEnabled();
      ['chat', 'mail', 'feed'].forEach(function (k) {
        const el = document.getElementById('dc-use-' + k);
        if (el) el.checked = getUse(k);
      });
      ['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
        const el = document.getElementById('dc-cat-' + k);
        if (el) el.checked = getCat(k);
      });
      // v3.28.x：使用概率 stepper 同样随 heal 重同步
      ['chat', 'mail', 'feed'].forEach(function (k) {
        const valEl = document.getElementById('dc-overall-' + k + '-val');
        if (valEl) valEl.value = String(dcOverallVal(k));
      });
      // v3.33.x：分类占比 stepper 同样随 heal 重同步
      ['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
        const valEl = document.getElementById('dc-prob-' + k + '-val');
        if (valEl) valEl.value = String(getProb(k));
      });
      // v3.32.x：功能字卡概率 stepper 同样随 heal 重同步
      Object.keys(DCF_DEF).forEach(function (k) {
        const valEl = document.getElementById('dcf-prob-' + k + '-val');
        if (valEl) valEl.value = String(dcfVal(k));
      });
      // v3.33.x：功能字卡总开关同样随 heal 重同步
      const deEl = document.getElementById('dcf-enabled');
      if (deEl) deEl.checked = dcfEnabled();
    } catch (e) {}
  });

  // ---- 双页共用渲染内核 ----
  // v3.16.x：把「分类 tab + 分组条 + 搜索 + 分批列表 + change 委托」抽成工厂，
  // 聊天默认字卡页（dc-* 锚点，仅基础分类）与 其他互动功能字卡页（fc-* 锚点，
  // 仅功能分类）各持一份独立状态；数据/开关键（dc-off-<分类>:*）与池 API 完全不变。
  // v3.26.x：渲染改为「视口虚拟窗口」（见下方常量注释）——工厂结构、DOM 类名、
  // 单卡开关键、tab/分组/搜索行为全部不变，只变列表的构建方式。
  const V_PAD = 0.8;    // 视口上下各多渲染 0.8 屏（重建频率 ≈ 每滚 0.8 屏一次）
  const V_MINW = 24;    // 窗口条目数下限（小屏/高条目时兜底，避免窗口过窄）
  const V_EST = 55;     // 未实测条目高度初值：.cc-item 13+13 padding + 行高 + 9 margin
  function mountCardView(ids, allowedKeys, emptyText, searchKeys) {
    const viewList = document.getElementById(ids.list);
    const viewTabs = document.getElementById(ids.tabs);
    const viewBar = document.getElementById(ids.groupsBar);
    const viewSearch = document.getElementById(ids.search);
    const pageEl = document.getElementById(ids.page);
    if (!viewList || !viewTabs || !viewBar || !viewSearch || !pageEl) return null;
    const view = {
      keys: allowedKeys.slice(),
      searchKeys: (searchKeys || []).slice(),
      cur: allowedKeys[0] || '',
      q: '',
      curGroup: ''
    };

    // ================= 虚拟窗口状态 =================
    // 实测（headless 390×844，空数据）：预设字卡 main 分类 4621 张旧版全量渲染 =
    // #dc-list 子树 33221 个节点、整页高 277922px、4628 个 checkbox，全站节点数从
    // 10841 翻到 44338；分批渲染仍占主线程 1.7s；点返回切页时 62 个 .page 的
    // MutationObserver + 全站选择器扫描在 4.4 万节点文档上放大（长任务 54ms）；
    // 二次进出更糟（进入阻塞 590ms、返回 182ms——display:none 销毁 3.3 万节点的
    // 渲染树，再显示要整棵重建）。iOS WebKit（Safari/Edge/Chrome 同内核）合成与内存
    // 开销还会再放大数倍，且残留 DOM 让之后每次切页都付这个税 → 真机反馈
    // 「进预设字卡能滑，点返回卡住，卡回去后整页都很卡」。
    // 方案：数据扁平成 flat[]（纯 JS，零 DOM），DOM 里只留视口上下各 V_PAD 屏的条目
    // （约 60~90 个节点），其余高度由顶部/底部占位块撑住；条目真实高度在插入后一次性
    // 读取并回填前缀和表，按窗口上方的累计变化量静默校正 scrollTop，长列表滚动位置不漂。
    let flat = [];                    // 当前列表数据（分组头 + 字卡）
    let n = 0;
    let hts = new Float64Array(0);    // 每条占位高度（实测或估计）
    let offs = new Float64Array(1);   // 前缀和：offs[i]=第 i 条顶部 y，offs[n]=总高
    let got = new Uint8Array(0);      // 该条是否已实测
    let est = V_EST;                  // 估计高度：随实测均值收敛
    let measSum = 0, measCnt = 0;
    let winLo = -1, winHi = -1;       // DOM 中已渲染窗口 [winLo, winHi)
    let topSpace = null, botSpace = null;
    // 滚动容器：元素 / 'win'（视口）/ null（未确认，按 'win' 处理）。
    // 三页布局不统一：#dc-list 有 CSS 显式放开 overflow 交给 .page 整页滚；
    // #fc-list/#dk-list 的 .card-list{flex:1} 在 .page(flex 列) 内被 min-height:auto
    // 撑开、自身不裁剪，实际滚的同样是 .page。只按 overflowY 样式选容器会把列表当成
    // 滚动容器（它的 scrollTop 恒 0）→ 窗口永不推进、往下滚全是空白。
    // 故以「确实在裁剪内容」判定，并在滚动事件里用 e.target 直接确认。
    let scroller = null;

    function clipsContent(el) {
      try {
        const oy = getComputedStyle(el).overflowY;
        if (oy !== 'auto' && oy !== 'scroll') return false;
        return el.scrollHeight > el.clientHeight + 1;
      } catch (e) { return false; }
    }
    function guessScroller() {
      if (scroller) return scroller;
      try {
        let el = viewList;
        while (el && el !== document.documentElement) {
          if (clipsContent(el)) { scroller = el; return scroller; }
          el = el.parentElement;
        }
      } catch (e) {}
      return null;
    }
    function onScroll(target) {
      if (pageEl.hidden) return;
      if (target && target.nodeType === 1) {
        // 元素滚动事件不冒泡、但 document 捕获阶段能收到：target 即滚动容器本身
        try { if (target !== viewList && !target.contains(viewList)) return; } catch (e) { return; }
        scroller = target;
      } else {
        const sc = guessScroller();
        if (sc && sc !== 'win') return;   // 本页有元素级滚动容器，视口滚动与我们无关
        scroller = 'win';
      }
      requestLayout(false);
    }
    function scrollY() {
      const sc = guessScroller();
      if (!sc || sc === 'win') return window.pageYOffset || document.documentElement.scrollTop || 0;
      return sc.scrollTop;
    }
    function setScrollY(v) {
      const sc = guessScroller();
      if (!sc || sc === 'win') window.scrollTo(0, v); else sc.scrollTop = v;
    }
    function recomputeOffsets() {
      if (offs.length !== n + 1) offs = new Float64Array(n + 1);
      let s = 0;
      for (let i = 0; i < n; i++) { offs[i] = s; s += hts[i]; }
      offs[n] = s;
    }
    function indexAt(y) {
      if (y <= 0) return 0;
      if (y >= offs[n]) return Math.max(0, n - 1);
      let a = 0, b = n;
      while (a < b) { const m = (a + b) >> 1; if (offs[m] <= y) a = m + 1; else b = m; }
      return Math.max(0, Math.min(n - 1, a - 1));
    }
    function makeNode(it, i) {
      const d = document.createElement('div');
      if (it.header) {
        d.className = 'cc-group-header';
        d.innerHTML = '<span class="ccg-name">' + it.gname + '</span><span class="ccg-count">' + it.count + '</span>';
      } else {
        const off = isCardOff(it.cat, it.c);
        d.className = 'cc-item glass' + (off ? ' off' : '');
        // 整页为系统预设字卡，统一标【系统】与自定义字卡区分（#301：词典自建词条标「自建」）；
        // 右侧单卡开关——逐张开启/关闭该字卡（关闭后功能/聊天回复不再抽取）
        d.innerHTML = '<div class="cc-txt"><div class="t">' + it.c + ' <span class="tc-known">' + (window.__dictCustomSet && window.__dictCustomSet.has(it.c) ? '自建' : '系统') + '</span></div></div>' +
          '<label class="toggle ccard-toggle"><input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span></label>';
      }
      d.dataset.idx = i;
      return d;
    }
    // 写完再读，只触发一次布局：连续兄弟的 offsetTop 差 = 该条实际占位高（含 margin）
    function measureAndFix() {
      const kids = viewList.children;
      const count = kids.length - 2;
      if (count < 2) return;
      const baseBefore = offs[winLo];
      let touched = false;
      // kids = [topSpace, 条目…, botSpace]；末条用 botSpace 的 offsetTop 收尾（占位块高度
      // 不影响自身 offsetTop，读到的仍是末条实际占位高）
      for (let k = 1; k <= count; k++) {
        const i = winLo + k - 1;
        const h = kids[k + 1].offsetTop - kids[k].offsetTop;
        if (h > 0 && h !== hts[i]) {
          if (got[i]) measSum += h - hts[i]; else { got[i] = 1; measSum += h; measCnt++; }
          hts[i] = h;
          touched = true;
        }
      }
      if (!touched) return;
      if (measCnt) est = Math.max(20, measSum / measCnt);
      recomputeOffsets();
      const delta = offs[winLo] - baseBefore;
      topSpace.style.height = offs[winLo] + 'px';
      botSpace.style.height = Math.max(0, offs[n] - offs[winHi]) + 'px';
      if (Math.abs(delta) >= 1) setScrollY(scrollY() + delta);
    }
    // 按当前滚动位置重排窗口；force=false 时请求范围仍落在已渲染范围内就直接跳过（防抖）
    function layout(force) {
      if (!n) { winLo = winHi = -1; return; }
      const sc = guessScroller();
      const isWin = !sc || sc === 'win';
      const vh = isWin ? window.innerHeight : sc.clientHeight;
      if (!vh) return;                  // 页面正隐藏：等显示时再排
      const y = scrollY();
      // 列表内容坐标系里滚动视口顶端的 y：列表自身就是滚动容器时即 scrollTop；
      // 否则滚动容器矩形顶 - 列表矩形顶（列表 rect 已含滚动位移，相减即滚掉的量）。
      // offs[] 以条目 border-box 顶为基准，.card-list 无 border/padding-top，两套坐标对齐。
      let a;
      if (sc === viewList) a = y;
      else a = (isWin ? 0 : sc.getBoundingClientRect().top) - viewList.getBoundingClientRect().top;
      const pad = vh * V_PAD;
      let lo = indexAt(Math.max(0, a - pad));
      let hi = Math.min(n, indexAt(Math.min(offs[n], a + vh + pad)) + 1);
      const need = V_MINW - (hi - lo);
      if (need > 0) {
        hi = Math.min(n, hi + need);
        const need2 = V_MINW - (hi - lo);
        if (need2 > 0) lo = Math.max(0, lo - need2);
      }
      if (!force && lo >= winLo && hi <= winHi) return;
      winLo = lo; winHi = hi;
      if (!topSpace) {
        topSpace = document.createElement('div'); topSpace.className = 'cc-vspace';
        botSpace = document.createElement('div'); botSpace.className = 'cc-vspace';
      }
      topSpace.style.height = offs[lo] + 'px';
      botSpace.style.height = Math.max(0, offs[n] - offs[hi]) + 'px';
      const frag = document.createDocumentFragment();
      frag.appendChild(topSpace);
      for (let i = lo; i < hi; i++) frag.appendChild(makeNode(flat[i], i));
      frag.appendChild(botSpace);
      viewList.textContent = '';
      viewList.appendChild(frag);
      measureAndFix();
    }
    let rafPending = false, rafForce = false;
    function requestLayout(force) {
      if (force) rafForce = true;
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        const f = rafForce;
        rafPending = false; rafForce = false;
        layout(f);
      });
    }
    function setData() {
      hts = new Float64Array(n); hts.fill(est);
      got = new Uint8Array(n);
      recomputeOffsets();
      winLo = winHi = -1;
    }
    function renderGroupsBar() {
      viewBar.innerHTML = '';
      const grps = DATA[view.cur] || [];
      const chips = [['', '全部']].concat(grps.map(g => [g[0], g[0]]));
      chips.forEach(([val, label]) => {
        const cEl = document.createElement('span');
        cEl.className = 'cc-g-chip' + (view.curGroup === val ? ' sel' : '');
        cEl.textContent = label;
        cEl.addEventListener('click', () => { view.curGroup = val; renderGroupsBar(); render(); });
        viewBar.appendChild(cEl);
      });
    }
    function render() {
      // 统一为 { key, gname, arr } 结构：非搜索时是当前 tab 的分组；
      // 搜索时跨 searchKeys 全库匹配（结果带来源 tab 名标注）
      let shown = (DATA[view.cur] || []).map(g => ({ key: view.cur, gname: g[0], arr: g[1] }));
      if (view.q) {
        const cross = [];
        (view.searchKeys.length ? view.searchKeys : view.keys).forEach(k => {
          (DATA[k] || []).forEach(g => {
            const arr = (g[1] || []).filter(c => c.indexOf(view.q) >= 0);
            if (arr.length || g[0].indexOf(view.q) >= 0) cross.push({ key: k, gname: g[0], arr });
          });
        });
        shown = cross;
      } else if (view.curGroup) {
        shown = shown.filter(g => g.gname === view.curGroup);
      }
      const list = [];
      shown.forEach(it => {
        list.push({ header: true, gname: (it.key !== view.cur ? '[' + tabLabel(it.key) + '] ' : '') + it.gname, count: it.arr.length });
        it.arr.forEach(c => list.push({ header: false, c, cat: it.key }));
      });
      flat = list; n = list.length;
      if (!n) {
        topSpace = botSpace = null;
        viewList.innerHTML = '<div class="cc-empty">' + emptyText + '</div>';
        winLo = winHi = -1;
        return;
      }
      setData();
      layout(true);
    }
    // change 事件委托——list 单一监听器替代每卡一个；窗口重建后 dataset.idx 仍指向 flat
    viewList.addEventListener('change', (e) => {
      const input = e.target;
      if (!input || input.type !== 'checkbox') return;
      const item = input.closest('.cc-item');
      if (!item) return;
      const rec = flat[Number(item.dataset.idx)];
      if (!rec || rec.header) return;
      const nowOff = !input.checked;
      // v3.26.x：跨 tab 搜索结果的字卡用其真实分类（rec.cat）存开关，而非当前 tab
      setCardOff(rec.cat || view.cur, rec.c, nowOff);
      item.classList.toggle('off', nowOff);
      toastCard(rec.c, nowOff);
    });
    viewTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.cc-tab[data-type]');
      if (!tab) return;
      if (view.keys.indexOf(tab.dataset.type) < 0) return;
      viewTabs.querySelectorAll('.cc-tab').forEach(t => t.classList.remove('sel'));
      tab.classList.add('sel');
      view.cur = tab.dataset.type;
      view.q = '';
      view.curGroup = '';
      renderGroupsBar();
      render();
    });
    viewSearch.addEventListener('input', () => {
      view.q = viewSearch.value.trim();
      clearTimeout(view._searchTimer);
      view._searchTimer = setTimeout(render, 150);
    });
    viewSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { viewSearch.value = ''; view.q = ''; render(); viewSearch.blur(); }
    });
    // 懒渲染：打开页才构建（大库不阻塞启动）。窗口只保留视口附近条目，常驻 DOM 恒定
    let renderedOnce = false;
    function ensureRendered() {
      if (renderedOnce) { requestLayout(true); return; }
      renderedOnce = true;
      document.addEventListener('scroll', function (e) { onScroll(e.target); }, { passive: true, capture: true });
      window.addEventListener('resize', () => requestLayout(true));
      // 页面隐藏时滚动容器的 scrollTop 归零、渲染树销毁：重新显示必须按新滚动位置重排
      if (typeof MutationObserver !== 'undefined') {
        try {
          new MutationObserver(() => { if (!pageEl.hidden) requestLayout(true); })
            .observe(pageEl, { attributes: true, attributeFilter: ['hidden'] });
        } catch (e) {}
      }
      refreshLibCount();
      renderGroupsBar();
      render();
    }
    return { view, ensureRendered, render };
  }

  // 聊天默认字卡页：仅四大基础分类（搜索跨全库，可在本页搜到功能字卡）
  const dcView = mountCardView({
    list: 'dc-list', tabs: 'dc-tabs', groupsBar: 'dc-groups-bar', search: 'dc-search-input', page: 'page-default-cards'
  }, BASE_KEYS, '暂无默认字卡', ALL_KEYS);
  // #301 词典 tab 自建词条行：仅词典 tab 显示；「存为语录/存为词」进词典分组与拼字引擎，
  // 「删自建」按原文精确删除（内置词条不可删，走单卡关闭）
  // #317：UI 行已按用户要求移除（词典是梦角语言资源，不提供手动存词条入口）——
  // dictCustomAdd/Remove API 与存储保留（历史自建词条仍在库中展示，可单卡关闭）
  (function () {
    const row = document.getElementById('dc-dict-add');
    if (!row || !dcView) return;
    const inp = document.getElementById('dc-dict-input');
    const sync = function () { try { row.hidden = dcView.view.cur !== 'dict'; } catch (e) {} };
    const tabs = document.getElementById('dc-tabs');
    if (tabs) tabs.addEventListener('click', function (e) {
      const t = e.target.closest('.cc-tab[data-type]');
      if (t) setTimeout(sync, 0);
    });
    const origEnsure = dcView.ensureRendered;
    dcView.ensureRendered = function () { const r = origEnsure.apply(null, arguments); sync(); return r; };
    const commit = function (kind) {
      const r = dictCustomAdd(kind, inp ? inp.value : '');
      toast(r.msg);
      if (r.ok) {
        if (inp) inp.value = '';
        if (dcView.render) dcView.render();
      }
    };
    const bq = document.getElementById('dc-dict-add-q');
    const bw = document.getElementById('dc-dict-add-w');
    if (bq) bq.addEventListener('click', () => commit('quote'));
    if (bw) bw.addEventListener('click', () => commit('word'));
    const bd = document.getElementById('dc-dict-del');
    if (bd) bd.addEventListener('click', () => {
      if (!window.openModal) { toast('弹窗组件不可用'); return; }
      window.openModal('删除自建词典词条', '', function (v) {
        if (v && dictCustomRemove(v)) {
          toast('已删除：' + String(v).replace(/\s+/g, ''));
          if (dcView.render) dcView.render();
        } else toast('未找到这条自建词条（内置词条不可删，可在列表里逐张关闭）');
      }, { staticText: '输入要删除的自建语录或词的原文（精确匹配）。内置词条无法删除，但可以在列表里逐张关闭。' });
    });
  })();
  // v3.35.x：词典独立分类——系统预设字卡里的单独入口（page-dict-cards），整页展示
  // DEFAULT_CARD_DATA.dict（语录+词库+扩展常用词），与「词典拼字」抽句/切词共用同一份数据。
  const dictView = mountCardView({
    list: 'd2-dict-list', tabs: 'd2-dict-tabs', groupsBar: 'd2-dict-groups-bar', search: 'd2-dict-search', page: 'page-dict-cards'
  }, ['dict'], '暂无词典字卡', ['dict']);
  // 词典自建词条行（本页全为词典，常驻显示）：存为语录/词、删自建，复用 dictCustomAdd/Remove
  // #317：UI 行已移除（用户要求），绑定代码随 getElementById(null) 自然空转，保留结构最小改动
  (function () {
    if (!dictView) return;
    const inp = document.getElementById('d2-dict-input');
    const commit = function (kind) {
      const r = dictCustomAdd(kind, inp ? inp.value : '');
      toast(r.msg);
      if (r.ok) { if (inp) inp.value = ''; if (dictView.render) dictView.render(); }
    };
    const bq = document.getElementById('d2-dict-add-q');
    const bw = document.getElementById('d2-dict-add-w');
    if (bq) bq.addEventListener('click', () => commit('quote'));
    if (bw) bw.addEventListener('click', () => commit('word'));
    const bd = document.getElementById('d2-dict-del');
    if (bd) bd.addEventListener('click', () => {
      if (!window.openModal) { toast('弹窗组件不可用'); return; }
      window.openModal('删除自建词典词条', '', function (v) {
        if (v && dictCustomRemove(v)) {
          toast('已删除：' + String(v).replace(/\s+/g, ''));
          if (dictView.render) dictView.render();
        } else toast('未找到这条自建词条（内置词条不可删，可在列表里逐张关闭）');
      }, { staticText: '输入要删除的自建语录或词的原文（精确匹配）。内置词条无法删除，但可以在列表里逐张关闭。' });
    });
  })();
  // v3.36.x：词典使用设置绑定（词典独立页）——场景开关（dict-use-chat/mail/feed）+
  //   使用概率（dict-overall-chat/mail/feed）+「使用的全部关闭」一键按钮。
  //   存储 per-cid（随桌面命名空间，同 dc-use-* 语义）；默认全开，概率默认：聊天 75
  //   （v3.40.x #370c 应需求从 100 降为 75——词典拼字是「概率触发」不该恒 100 全用了，保留正常
  //   回复空间）、写信/朋友圈 30（新混入场景）。
  //   消费方统一走 window.dictUse(scene) / window.dictOverall(scene) 读：
  //   quote-spell.js（聊天门）、mail.js taLetterContent（写信混入）、feed.js cardPool（朋友圈混入）。
  (function () {
    if (!dictView) return;
    const st = function () { try { return window.activeStore(); } catch (e) { return null; } };
    const gUse = function (k) { const s = st(); const v = s ? s.get('dict-use-' + k) : null; return v === null ? true : v === '1'; };
    const sUse = function (k, on) { const s = st(); if (s) s.set('dict-use-' + k, on ? '1' : '0'); };
    const DICT_OVERALL_DEF = { chat: 75, mail: 30, feed: 30 };
    const gOv = function (k) { const s = st(); const v = s ? s.get('dict-overall-' + k) : null; return v === null ? DICT_OVERALL_DEF[k] : Math.max(0, Math.min(100, Number(v))); };
    const sOv = function (k, nv) { const s = st(); if (s) s.set('dict-overall-' + k, String(nv)); };
    // 只读 API（跨文件消费）
    window.dictUse = function (scene) { return gUse(scene === 'mail' ? 'mail' : scene === 'feed' ? 'feed' : 'chat'); };
    window.dictOverall = function (scene) { return gOv(scene === 'mail' ? 'mail' : scene === 'feed' ? 'feed' : 'chat'); };
    // #390：二级锁与词典的关系提示——「防未成年人锁定」锁的是全部系统内置字卡（词典是其中
    //   一类），锁定时聊天/写信/朋友圈都不会用词典，下方场景开关全开也没效果。此前这层关系
    //   只在回复设置链路自检里提了一句「二级锁未解锁」，用户在词典页看到开关全开却无效果、
    //   看不懂和开屏二级密码的关系（用户实报）。这里在词典页顶部当场讲清：锁定=词典整体停用
    //   +去哪解锁；解锁/重锁事件即时刷新（card-lock.js 在本文件之前加载，cardLockOpen 必在）。
    const lockHint = document.getElementById('dict-lock-hint');
    function renderDictLockHint() {
      if (!lockHint) return;
      let locked = false;
      try { locked = !!(window.cardLockOpen && !window.cardLockOpen()); } catch (e) { locked = false; }
      if (!locked) { lockHint.hidden = true; lockHint.textContent = ''; return; }
      lockHint.hidden = false;
      lockHint.textContent = '防未成年人锁定开启中：词典属于系统内置字卡，锁定时聊天 / 写信 / 朋友圈都不会使用词典（下方开关全开也没效果，不是没保存）。到开屏公告区「防未成年人·内置字卡锁定」卡输入密码解锁，解锁后自动恢复，无需改这里任何开关。';
    }
    renderDictLockHint();
    document.addEventListener('mochi-cardlock-open', renderDictLockHint);
    document.addEventListener('mochi-cardlock-locked', renderDictLockHint);
    [['chat', '聊天'], ['mail', '写信'], ['feed', '朋友圈']].forEach(function (pair) {
      const k = pair[0], label = pair[1];
      const el = document.getElementById('dict-use-' + k);
      if (el) {
        el.checked = gUse(k);
        el.addEventListener('change', function () {
          sUse(k, el.checked);
          toast((el.checked ? '已开启' : '已关闭') + '：词典' + label + '使用');
        });
      }
      const box = document.getElementById('dict-overall-' + k);
      const valEl = document.getElementById('dict-overall-' + k + '-val');
      if (box && valEl) {
        valEl.value = String(gOv(k));
        const step = function (d) {
          const nv = Math.max(0, Math.min(100, (parseInt(valEl.value, 10) || 0) + d));
          valEl.value = String(nv); sOv(k, nv);
          toast('词典' + label + '使用概率：' + nv + '%');
        };
        const bMin = box.querySelector('.stp-min');
        const bMax = box.querySelector('.stp-max');
        if (bMin) bMin.addEventListener('click', function () { step(-5); });
        if (bMax) bMax.addEventListener('click', function () { step(5); });
      }
    });
    // 使用的全部关闭：三场景一键停用（弹窗确认；之后可逐个再打开）
    const ca = document.getElementById('dict-use-closeall');
    if (ca) ca.addEventListener('click', function () {
      const doClose = function () {
        ['chat', 'mail', 'feed'].forEach(function (k) {
          sUse(k, false);
          const el = document.getElementById('dict-use-' + k);
          if (el) el.checked = false;
        });
        toast('已关闭词典全部场景使用');
      };
      if (!window.openModal) { doClose(); return; }
      window.openModal('词典使用的全部关闭', '将同时关闭词典的聊天 / 写信 / 朋友圈三个场景使用（单卡开关不受影响，可随时再逐个打开）。', function () {
        doClose();
      }, { staticText: '确定执行？' });
    });
  })();
  const liDict = document.getElementById('li-dict-cards');
  if (liDict) {
    liDict.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const page = document.getElementById('page-dict-cards');
      if (page) page.hidden = false;
      if (dictView) dictView.ensureRendered();
    });
  }
  const dictBack = document.getElementById('dict-back');
  if (dictBack) {
    dictBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
  }
  // 其他互动功能字卡页：仅功能分类（模板已预置全部功能 tab；搜索同样跨全库）
  const fcView = mountCardView({
    list: 'fc-list', tabs: 'fc-tabs', groupsBar: 'fc-groups-bar', search: 'fc-search-input', page: 'page-fun-cards'
  }, FUNC_KEYS, '暂无功能触发字卡', ALL_KEYS);

  // 兜底：若 template 静态 fc-tabs 里缺某个 FUNC_KEYS 分类，动态补一个 tab。
  // （其余功能分类已在模板静态预置；新增功能的 tab 靠这里自动补。）
  (function () {
    const tabs = document.getElementById('fc-tabs');
    if (!tabs) return;
    const known = Array.prototype.map.call(tabs.querySelectorAll('.cc-tab'), t => t.dataset.type);
    FUNC_KEYS.forEach(function (k) {
      if (known.indexOf(k) >= 0) return;
      const b = document.createElement('button');
      b.className = 'cc-tab';
      b.dataset.type = k;
      b.textContent = k === 'deskcheck' ? '联系人跨桌面查岗' : k;
      tabs.appendChild(b);
    });
  })();

  // 联系人跨桌面查岗（独立入口，单独页面渲染）：仅 deskcheck 一个分类
  const dkView = mountCardView({
    list: 'dk-list', tabs: 'dk-tabs', groupsBar: 'dk-groups-bar', search: 'dk-search-input', page: 'page-deskcheck'
  }, ['deskcheck'], '暂无联系人跨桌面查岗字卡', ['deskcheck']);

  // 入口/返回
  const li = document.getElementById('li-default-cards');
  if (li) {
    li.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const page = document.getElementById('page-default-cards');
      if (page) page.hidden = false;
      if (dcView) dcView.ensureRendered();
    });
  }
  const back = document.getElementById('dc-back');
  if (back) {
    back.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
  }
  const liFun = document.getElementById('li-fun-cards');
  if (liFun) {
    liFun.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const page = document.getElementById('page-fun-cards');
      if (page) page.hidden = false;
      if (fcView) fcView.ensureRendered();
    });
  }
  const fcBack = document.getElementById('fc-back');
  if (fcBack) {
    fcBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
  }
  const liDk = document.getElementById('li-deskcheck');
  if (liDk) {
    liDk.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const page = document.getElementById('page-deskcheck');
      if (page) page.hidden = false;
      if (dkView) dkView.ensureRendered();
    });
  }
  const dkBack = document.getElementById('dk-back');
  if (dkBack) {
    dkBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
  }

  // ---- 回复混入：供 chat.js 调用 ----
  // 返回当前分类下按权重选中一个分组的字卡数组；未触发返回 []
  // v3.12.x：核心逻辑抽成 getDefaultCardsFor(st)——st 传目标桌面 store；
  //   群聊用它按成员所在桌面抽取（成员桌面关了聊天使用 → 该成员在群聊里也不用默认字卡）
  // v3.28.x：scene 参数化——概率/场景开关按场景读（chat/mail/feed；缺省 chat）。
  //   drawCards 目前仅聊天类调用（getDefaultCards*），写信/朋友圈各走自己的消费逻辑
  function drawCards(a, scene) {
    scene = scene || 'chat';
    if (LOCKED()) return []; // #319 锁定＝不抽任何系统预设字卡
    // v3.7.x：场景开关——关闭后该场景不混入默认字卡
    if (!a.use(scene)) return [];
    const cfg = a.cfg();
    if (!cfg.enabled) return [];
    const overall = cfg.overallFor ? cfg.overallFor(scene) : cfg.overall;
    if (Math.random() * 100 >= overall) return [];
    // 按 probs 加权选分类（v3.8.x：已关闭的分类权重按 0 处理，不参与抽取）
    const keys = ['main', 'kaomoji', 'emoji', 'touch'];
    const weights = keys.map(k => (a.cat(k) ? Math.max(0, cfg.probs[k] || 0) : 0));
    const total = weights.reduce((x, y) => x + y, 0);
    if (total <= 0) return [];
    let roll = Math.random() * total;
    let chosen = 'main';
    for (let i = 0; i < keys.length; i++) {
      roll -= weights[i];
      if (roll < 0) { chosen = keys[i]; break; }
    }
    // v3.6.x：单卡开关过滤——用户关闭的字卡不参与抽取，整组关完则跳过该组
    const grps = (DATA[chosen] || [])
      .map(g => [g[0], g[1].filter(c => !a.isOff(chosen, c))])
      .filter(g => g[1].length);
    if (!grps.length) return [];
    const g = grps[Math.floor(Math.random() * grps.length)];
    const text = g[1][Math.floor(Math.random() * g[1].length)];
    return { text: text, type: chosen === 'touch' ? 'poke' : 'text' };
  }
  window.getDefaultCardsFor = function (st, scene) { return drawCards(apiFor(st), scene); };
  window.getDefaultCards = function (scene) { return drawCards(api, scene); };
  // 默认字卡分组（供页面按分组查看）
  window.getDefaultCardGroups = function (cat) {
    if (LOCKED()) return []; // #319 锁定＝系统预设字卡不存在
    return (DATA[cat] || []).slice();
  };
  // v3.7.x：互动回应预设池读取（供互动卡片回复侧使用）——name 分组名（邀请TA·接受/
  // 邀请TA·拒绝/问问TA·回应/小问题·回应/好奇·回应/吐槽·回应/询问·回应），
  // 与「互动回应」tab 展示同源（DEFAULT_CARD_DATA.interact）；数据缺失时回退 fallback
  // v3.13.x：泛化为 getLibPool(分类, 分组, 兜底)——摸鱼浮字/花园/同频/伸手/喝水/存钱罐
  // 各功能统一走它取同源池（消费侧再按 isDefaultCardOff(分类, 文案) 过滤已关卡片）
  // v3.32.x：并入用户自建的功能字卡（字卡库→可自定义字卡→其他互动功能字卡，存 cc-groups
  // 功能分类字段）——自定义卡追加在同源池后一起随机抽取；非功能分类/无自定义时不影响原行为
  window.getLibPool = function (cat, group, fallback) {
    if (LOCKED()) { // #319 锁定＝只回自建功能字卡，内置同源池与 fallback 兜底都不给
      try { return (window.getCustomFuncCards && window.getCustomFuncCards(cat)) || []; } catch (e) { return []; }
    }
    const g = (DATA[cat] || []).find(x => x[0] === group);
    let arr = g && Array.isArray(g[1]) && g[1].length ? g[1] : (Array.isArray(fallback) ? fallback : []);
    arr = arr.slice();
    try {
      const cf = (window.getCustomFuncCards && window.getCustomFuncCards(cat)) || [];
      if (cf.length) arr = arr.concat(cf);
    } catch (e) {}
    return arr;
  };
  window.getInteractPool = function (name, fallback) {
    return window.getLibPool('interact', name, fallback);
  };
  window.getFishPool = function (name, fallback) {
    return window.getLibPool('fish', name, fallback);
  };
  // v3.17.x：桌面查岗回应字卡池（跨桌面「来消息」查岗——回复后按概率抽取，见 chat.js）
  // v3.18.x：按方向取池——dir 'meToTa'（联系人申请我对联系人查岗）抽「联系人申请我对
  // 联系人查岗」分组，否则（toMe / 未指定）抽「联系人对我查岗」分组，过滤已关卡片
  window.getDeskCheckPool = function (dir, fallback) {
    const group = dir === 'meToTa' ? '联系人申请我对联系人查岗' : '联系人对我查岗';
    let arr = window.getLibPool('deskcheck', group, fallback);
    if (!arr.length && Array.isArray(fallback) && fallback.length) arr = fallback.slice();
    return arr.filter(c => !(window.isDefaultCardOff && window.isDefaultCardOff('deskcheck', c)));
  };
})();
