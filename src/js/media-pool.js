// ===== #142 媒体池（内容寻址去重）=====
// 问题：聊天记录/收藏里同一张表情包/图片每发一次就整份 base64 存一遍（诊断实证
// chat-msgs 全桌面 ≈214MB，其中同一批字卡表情重复占大头）。
// 方案：图片 dataURL 按 SHA-256 内容哈希存进全局媒体池（IndexedDB 键 xy-home-v2:media:<hash>，
// 只存一份），消息/收藏里替换为令牌 @@m:<hash32>。令牌跨桌面/跨会话/跨设备（备份携带池键）
// 稳定自描述。渲染解析集中在本文档级 MutationObserver——img[src^="@@m:"] 内存命中同步重写、
// 未命中异步取回后重写，业务渲染代码零改动。
// 数据安全底线：
//   · 池数据落盘先于引用落盘（normalize 流程先 mochiMediaFlush 再 saveMsgs）——崩溃窗口内
//     最多「池多一条孤儿」，绝不会出现「令牌入库而池数据丢失」；
//   · 写池前先查池（idbGetMany 批量）——已有同哈希条目不重复写，跨会话零重写；
//   · crypto.subtle 不可用（非安全上下文）时整模块禁用，一切保持旧路径，绝无半启用态；
//   · v1 池只增不删（无 GC），孤儿条目体积=去重后的唯一内容量，可控。
// FIX 2026-09-10 #283 池收音频：tokenize 放行 data:audio/（语音）——历史语音/语音字卡以
// 「名称|||data:audio/…」整份内联在消息 text，chat-msgs 常年几十 MB，每次落盘 structured
// clone 整包＝低端机长任务/「经常卡按不动」。音频内容唯一（录音无法去重缩总库），但令牌化后
// 每次落盘只 clone 44 字符引用。音频纪律：①不进 map 热缓存（迁移批量会把省下的内存吃回去），
// ②播放走 mochiMediaExpandAsync 按需 idbGet；图片路径（map/观察器）行为不变。
// 消费方：chat.js（消息令牌化 normalize + 编辑入口展开 + 语音播放取回）、chat.js 收藏压缩管道（CAS）。
// 注意：本文件须在 chat.js 之前加载（渲染解析要先于首屏渲染就位），jsFiles 已登记。
(function () {
  const FULL = 'xy-home-v2:media:';
  const TOK = '@@m:';
  const TOKEN_RE = /^@@m:([0-9a-f]{32})$/;
  // 非安全上下文/无 IDB → 整模块禁用（提供恒空展开，业务侧按 null 回退原值）
  const OK = typeof crypto !== 'undefined' && crypto.subtle && window.idbGet && window.idbGetMany && window.idbSetAll;
  window.mochiMediaExpand = function (s) { return null; };
  // #283 音频令牌异步取回（禁用态恒 null，调用方按缺失占位）
  window.mochiMediaExpandAsync = function (s, cb) { try { cb(null); } catch (e) {} };
  window.mochiMediaIsToken = function (s) { return typeof s === 'string' && TOKEN_RE.test(s); };
  if (!OK) return;

  const map = new Map();            // hash -> dataURL（已解析/已落池内容，渲染热缓存）
  // FIX 2026-09-13 #387 令牌缺失负缓存——公用库被 #377 写回泄漏持久化令牌后，无池数据
  // 的设备（公用库跨设备共享不带池键）令牌永远解不出图＝字卡库纯白图/面板空分组/发出去
  // 全是坏图。这里记录「idbGet 确认缺失」的 hash：①mochiMediaTokenMissing 供媒体筛选端
  // 剔除（不 send 白图卡）；②观察器给已渲染 img 打 media-tok-missing 占位（诚实可见，
  // 不再纯白）。可自愈：idbGet 后续读到有效值即从 missing 除名（不学 #275 永久负缓存，
  // 导入完整备份补回池键后下次渲染即恢复）。
  const missing = new Set();        // hash -> true（idbGet 确认池缺失）
  window.mochiMediaTokenMissing = function (s) { const m = TOKEN_RE.exec(s || ''); return !!(m && missing.has(m[1])); };
  function markMissing(h) {
    let nodes;
    try { nodes = document.querySelectorAll('img[src="' + TOK + h + '"]'); } catch (e) { nodes = []; }
    Array.prototype.forEach.call(nodes, function (el) {
      try { el.classList.add('media-tok-missing'); if (!el.alt) el.alt = '图片缺失'; } catch (e2) {}
    });
  }
  const inflight = {};              // hash -> true（渲染侧单飞取回）
  let writeBuf = [];                // 待落池 [{k,v}]
  let flushT = null;
  // 真实现（OK 路径）：令牌→池内容；未知哈希/非令牌→null（调用方按 null 回退原值）
  window.mochiMediaExpand = function (s) {
    const m = TOKEN_RE.exec(s || '');
    return m ? (map.get(m[1]) || null) : null;
  };
  // FIX 2026-09-10 #283 音频令牌异步取回：map 命中（本会话刚写池未冲刷的窗口）或按需
  // idbGet；校验 data:audio/ 前缀（图片走观察器不经过这里）；音频绝不回填 map（内存纪律，
  // 见文件头）；取不到（池缺失/被剥空/脏值）→ null，调用方按「语音数据缺失」占位。
  window.mochiMediaExpandAsync = function (s, cb) {
    const done = function (v) { try { cb(v); } catch (e) {} };
    const m = TOKEN_RE.exec(String(s || ''));
    if (!m) { done(null); return; }
    const c = map.get(m[1]);
    if (typeof c === 'string' && c.indexOf('data:audio/') === 0) { done(c); return; }
    window.idbGet(FULL + m[1]).then(function (v) {
      done(typeof v === 'string' && v.indexOf('data:audio/') === 0 ? v : null);
    }).catch(function () { done(null); });
  };

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    const arr = new Uint8Array(buf);
    let out = '';
    for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, '0');
    return out.slice(0, 32); // 128 位十六进制前缀——实际内容寻址撞库概率为 0，键长可控
  }
  window.mochiMediaFlush = function () {
    if (flushT) { clearTimeout(flushT); flushT = null; }
    if (!writeBuf.length) return Promise.resolve(true);
    const buf = writeBuf.splice(0);
    return window.idbSetAll(buf).then(function (ok) {
      if (!ok) { writeBuf = buf.concat(writeBuf); scheduleFlush(); }
      return ok;
    }).catch(function () { writeBuf = buf.concat(writeBuf); scheduleFlush(); return false; });
  };
  function scheduleFlush() { if (!flushT) flushT = setTimeout(function () { flushT = null; window.mochiMediaFlush(); }, 300); }
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') window.mochiMediaFlush();
    });
  } catch (e) {}

  // 池探测队列：同一哈希的多次 tokenize 合并成一次 idbGetMany（跨记录重复表情只查/写一次）
  const lookupQueue = new Map();    // hash -> { data, cbs:[] }
  let lookupT = null;
  window.mochiMediaTokenize = function (dataUrl, opts) {
    return new Promise(function (resolve) {
      // FIX 2026-09-10 #283 放行 data:audio/（语音令牌化）；<1024 小载荷不进池
      if (typeof dataUrl !== 'string' || dataUrl.length < 1024 ||
          (dataUrl.indexOf('data:image/') !== 0 && dataUrl.indexOf('data:audio/') !== 0)) { resolve(null); return; }
      sha256Hex(dataUrl).then(function (h) {
        if (map.has(h)) { resolve(TOK + h); return; }
        let q = lookupQueue.get(h);
        if (!q) { q = { data: dataUrl, cbs: [], nc: !!(opts && opts.noCache) }; lookupQueue.set(h, q); }
        q.cbs.push(resolve);
        if (!lookupT) lookupT = setTimeout(runLookups, 60);
      }).catch(function () { resolve(null); });
    });
  };
  async function runLookups() {
    lookupT = null;
    if (!lookupQueue.size) return;
    const entries = Array.from(lookupQueue.entries());
    lookupQueue.clear();
    let dirty = false;
    for (let i = 0; i < entries.length; i += 40) {
      const slice = entries.slice(i, i + 40);
      let vals = {};
      try { vals = (await window.idbGetMany(slice.map(function (e) { return FULL + e[0]; }))) || {}; } catch (e) { vals = {}; }
      slice.forEach(function (e) {
        const v = vals[FULL + e[0]];
        // FIX 2026-09-10 #283 只有图片进 map 热缓存；音频内容唯一且体积大（一次语音迁移
        // 可达几十 MB），缓存=把令牌化省下的内存原样吃回，只写池/查池不缓存
        // #377 noCache 选项：字卡库大库内存瘦身令牌化用——池命中/新写都不进 map 热缓存，
        // 渲染时走下方 resolveImg 懒解析按需进 map（只驻留真正显示过的图）
        const isImg = e[1].data.indexOf('data:image/') === 0;
        const nc = !!e[1].nc;
        if (typeof v === 'string') { if (isImg && !nc) map.set(e[0], v); }          // 池里已有（跨会话/桌面重复）→ 不重写
        else { if (isImg && !nc) map.set(e[0], e[1].data); writeBuf.push({ k: FULL + e[0], v: e[1].data }); dirty = true; }
        e[1].cbs.forEach(function (cb) { try { cb(TOK + e[0]); } catch (e2) {} });
      });
      await new Promise(function (r) { setTimeout(r, 0); }); // 分批让出主线程
    }
    if (dirty) scheduleFlush();
  }

  // ===== 集中渲染解析：img[src^="@@m:"] → 池数据 =====
  function resolveImg(img) {
    const m = TOKEN_RE.exec(img.getAttribute('src') || '');
    if (!m) return;
    const h = m[1];
    const v = map.get(h);
    if (v) { img.src = v; return; }
    if (inflight[h]) return;
    inflight[h] = true;
    window.idbGet(FULL + h).then(function (v2) {
      delete inflight[h];
      // FIX 2026-09-10 #275 池值体检：池里只可能存 data:image/ 字符串（tokenize 入口已保证）。
      // 读到空串/脏值（旧「只备份文字」备份把池 dataURL 剥成 "" 再导入所致）绝不能当有效数据：
      // 原 `typeof v2 !== 'string'` 放行空串 → map 永久缓存 '' + img.src=''（解析成页面 URL）
      // ＝永久坏图且占位误报「网络不通」。改与「池缺失」同路：保持令牌原样交给 #186/#202 占位；
      // 日后导入完整备份补回池键，下次渲染经此处重读即自愈（不入 map 负缓存，缺数据可重试）。
      if (typeof v2 !== 'string' || v2.indexOf('data:image/') !== 0) { missing.add(h); markMissing(h); return; }
      missing.delete(h); // 后续读到有效值＝池已补回（导入完整备份等），解除剔除/占位
      map.set(h, v2);
      let nodes;
      try { nodes = document.querySelectorAll('img[src="' + TOK + h + '"]'); } catch (e) { nodes = []; }
      Array.prototype.forEach.call(nodes, function (el) { el.src = v2; });
    }).catch(function () { delete inflight[h]; });
  }
  function scanRoot(root) {
    if (!root) return;
    let nodes;
    try { nodes = root.querySelectorAll ? root.querySelectorAll('img[src^="' + TOK + '"]') : null; } catch (e) { return; }
    if (nodes) Array.prototype.forEach.call(nodes, resolveImg);
    if (root.tagName === 'IMG') resolveImg(root);
  }
  try {
    const obs = new MutationObserver(function (muts) {
      for (let i = 0; i < muts.length; i++) {
        const mu = muts[i];
        if (mu.type === 'attributes' && mu.target && mu.target.tagName === 'IMG') resolveImg(mu.target);
        else if (mu.type === 'childList') {
          for (let j = 0; j < mu.addedNodes.length; j++) scanRoot(mu.addedNodes[j]);
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  } catch (e) {}
  // 观察器挂载前已存在的 DOM（本脚本先于 body 尾部业务渲染执行，正常为空）兜底扫一遍
  function bootScan() { scanRoot(document); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootScan);
  else bootScan();

  // ===== v3.26.x 存储优化：孤儿媒体 GC（mark-and-sweep）=====
  // 背景：#142 v1 池只增不删——消息/收藏删除后池内图片永留，长账用户池底越滚越大。
  // 安全底线（宁可漏删、绝不误删）：
  //   · mark 集 = 全部 *:chat-msgs + *:fav-msgs（含旧顶层键）里的令牌 ∪ 本会话
  //     map/writeBuf/inflight（含「刚令牌化还没落库」的新图）——令牌只由 chat.js 写进
  //     消息与收藏（#142 设计），扫描面即全覆盖；
  //   · 引用键逐键串行读，读完即弃引用（峰值内存≈最大单个聊天包）；
  //   · 清单读失败 / 任一引用键读不到（idbGet 超时返回 undefined 与「键不存在」不可分）
  //     → 整次放弃不删：没读到可能藏着唯一引用，删了就是永久坏图；
  //   · 只删池键，绝不动聊天/收藏；确认交互由调用方（查看存储页）负责。
  window.mochiMediaGC = function () {
    return (async function () {
      const out = { ok: false, reason: '', orphans: [], bytes: 0, poolN: 0, refN: 0 };
      if (!window.idbListKeys || !window.idbGet || !window.idbGetMany) { out.reason = '接口不可用（需安全上下文）'; return out; }
      try { await window.mochiMediaFlush(); } catch (e) {}
      const keys = await window.idbListKeys();
      if (!keys) { out.reason = '键清单读取失败（存储繁忙），本次不清理'; return out; }
      const SCAN_RE = /@@m:([0-9a-f]{32})/g;
      const keep = new Set();
      map.forEach(function (_v, h) { keep.add(h); });
      writeBuf.forEach(function (p) { keep.add(String(p.k).slice(FULL.length)); });
      Object.keys(inflight).forEach(function (h) { keep.add(h); });
      // FIX 2026-09-06 #186 引用扫描面补全：旧正则 /(?:^|:)(?:chat-msgs|fav-msgs)$/ 漏了
      // ①群聊键 xy-home-v2:group-chat-msgs / :gc-msgs-<gid>（前缀是 group- 不是 :，不匹配）
      // ②LS 快照/尾巴日志（#180：IDB 写失败机型上消息只在 localStorage/xy-home-v2:<cid>:chat-tail）
      // → 这些引用的表情/图片令牌被误判孤儿删除 = 单发表情包/图片变空白气泡且不可逆。
      // 修复：REFS 扩到群聊+尾巴键；并追加扫描 localStorage 同名键（读到的令牌全部进 keep，
      // 宁可漏删绝不误删；LS 读异常时放弃本次清理）。
      const REFS = /(?:^|:)(?:chat-msgs|fav-msgs|group-chat-msgs|gc-msgs-[0-9A-Za-z_-]+|chat-tail)$/;
      const refKeys = keys.filter(function (k) { return REFS.test(String(k)); });
      try {
        for (let li = 0; li < localStorage.length; li++) {
          const lk = localStorage.key(li);
          if (lk && REFS.test(lk)) refKeys.push('__ls__' + lk);
        }
      } catch (lErr) { out.reason = 'localStorage 读取失败（存储繁忙），为安全起见本次不清理'; return out; }
      out.refN = refKeys.length;
      for (let i = 0; i < refKeys.length; i++) {
        let v;
        if (refKeys[i].indexOf('__ls__') === 0) {
          // FIX 2026-09-06 #186 LS 引用键：令牌可能在 LS 快照/尾巴日志里有、IDB 还没落——必须一并标记
          try { v = localStorage.getItem(refKeys[i].slice(6)); } catch (e2) { v = undefined; }
          if (v === undefined || v === null) continue; // 该 LS 键刚好被清＝无引用可标，不构成放弃条件
        } else {
          v = await window.idbGet(refKeys[i]);
          if (v === undefined || v === null) { out.reason = '有聊天记录/收藏没读到（存储繁忙？），为安全起见本次不清理'; return out; }
        }
        let s = '';
        try { s = typeof v === 'string' ? v : (JSON.stringify(v) || ''); } catch (e2) { out.reason = '引用数据序列化失败，本次不清理'; return out; }
        SCAN_RE.lastIndex = 0;
        let m;
        while ((m = SCAN_RE.exec(s))) keep.add(m[1]);
        s = '';
      }
      const poolKeys = keys.filter(function (k) { return String(k).indexOf(FULL) === 0; });
      out.poolN = poolKeys.length;
      const orphans = [];
      for (let i = 0; i < poolKeys.length; i++) {
        if (!keep.has(String(poolKeys[i]).slice(FULL.length))) orphans.push(String(poolKeys[i]));
      }
      // 孤儿体积只用于报告：分批读、读完即弃（峰值≈一批×单图大小）
      let bytes = 0;
      for (let i = 0; i < orphans.length; i += 16) {
        const batch = orphans.slice(i, i + 16);
        let vals = {};
        try { vals = (await window.idbGetMany(batch)) || {}; } catch (e3) {}
        batch.forEach(function (k) { const v = vals[k]; if (typeof v === 'string') bytes += v.length * 2; });
      }
      out.orphans = orphans;
      out.bytes = bytes;
      out.ok = true;
      return out;
    })().catch(function (e) { return { ok: false, reason: '扫描异常：' + ((e && e.message) || e), orphans: [], bytes: 0, poolN: 0, refN: 0 }; });
  };
  // 扫描报告里的孤儿真正删除（查看存储页确认后调用）；返回成功删除条数
  window.mochiMediaGCApply = function (orphans) {
    return (async function () {
      const list = (orphans || []).map(String);
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        let ok = false;
        try { ok = await window.idbDelete(list[i]); } catch (e) { ok = false; }
        if (ok) { map.delete(list[i].slice(FULL.length)); n++; }
      }
      return n;
    })();
  };
})();
