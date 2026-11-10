// alertas-motor.js — vigia do Scanner de Estrutura (gerado; não editar à mão). 2026-11-10T11:55:58.109Z
// Motor de estrutura de mercado (estilo ICT, quebras confirmadas por fecho do corpo)
// candles: [{t, o, h, l, c, v}] apenas velas FECHADAS, por ordem cronológica
(function (root) {
  const DEFAULTS = {
    lockBars: 2,      // velas sem novo extremo para fixar o topo/fundo da perna (início do recuo)
    minRetraceAtr: 0, // recuo mínimo (em ATR) para o extremo contar como swing: maior = escala externa
    pivotLen: 2,      // pivots usados só para arrancar a estrutura no início dos dados
    confirm: 1,       // fechos consecutivos para confirmar uma quebra (1 ou 2)
    volMult: 1.5,     // volume da vela da quebra >= volMult x média => "com volume"
    volLen: 20,
    atrLen: 14,
    requireDisp: false, // a quebra só conta com displacement (vela forte, FVG ou continuação)
    dispAtr: 1.0,       // vela forte: corpo >= dispAtr x ATR e >= 60% da vela; continuação: fecho >= dispAtr x ATR para lá do nível
    contBars: 3,        // velas de espera por continuação quando a vela da quebra não é forte
    fvgMinAtr: 0.3,     // FVG só conta como displacement se tiver pelo menos 0,3 x ATR
    contAtr: 1.0,       // continuação: fecho pelo menos contAtr x ATR para lá do nível
    closeMarginAtr: 0.3, // o fecho tem de ficar claramente para lá do nível (>= 0,3 x ATR); "logo acima" não chega
    acceptBars: 1,      // velas seguintes que também têm de fechar para lá do nível (aceitação); fechar de volta = sweep
    failBars: 4,
    legRatio: 0,        // swing pela proporção da perna: recuo >= legRatio x tamanho da perna que o formou (0 = só ATR)
    holdBars: 2,        // aceitação prolongada: N fechos seguidos para lá do nível (com margem) também confirmam a quebra        // quebra falhada: se nas N velas seguintes o preço fechar de volta para lá do nível, a quebra é anulada (0 = desligado)
  };

  // Displacement: 'ok' (conta), 'wait' (à espera de continuação) ou 'reject' (não conta)
  function makeDisp(candles, atr, fvgs, o) {
    const fn = function (dir, level, i, j) {
      const c = candles; fn.why = null;
      for (let k = i + 1; k <= j; k++) if (dir === 1 ? c[k].c <= level : c[k].c >= level) return 'reject';  // voltou para dentro
      const why = crit(dir, level, i, j);
      // o fecho atual tem de estar claramente para lá do nível, e já ter sido aceite pelas velas seguintes
      if (why && dir * (c[j].c - level) >= o.closeMarginAtr * (atr[i] || 0) && j - i >= o.acceptBars) { fn.why = why; return 'ok'; }
      return j - i >= Math.max(o.contBars, o.acceptBars) ? 'reject' : 'wait';
    };
    const crit = function (dir, level, i, j) {
      const c = candles;
      for (let k = i; k <= j; k++) {
        const body = c[k].c - c[k].o, rng = c[k].h - c[k].l || 1e-12;
        if (Math.sign(body) === dir && Math.abs(body) >= o.dispAtr * (atr[k] || 0) && Math.abs(body) / rng >= 0.6) return k === i ? 'vela forte' : 'vela forte a seguir';
      }
      // FVG de displacement: no sentido da quebra e com tamanho relevante (>= fvgMinAtr x ATR)
      if (fvgs.some((f) => f.dir === dir && f.created <= j && f.mid >= i - 1 && f.mid <= j && f.top - f.bot >= o.fvgMinAtr * (atr[f.created] || 0))) return 'FVG';
      if (dir * (c[j].c - level) >= o.contAtr * (atr[i] || 0)) return 'continuação';
      // aceitação prolongada: N fechos seguidos sem voltar para dentro do nível (a margem é verificada no fecho atual)
      if (o.holdBars > 0 && j - i >= o.holdBars - 1) return 'aceitação';
      return null;
    };
    return fn;
  }

  const hasMan = (ov) => !!(ov && ((ov.add && ov.add.size) || ov.start || (ov.yesBreak && ov.yesBreak.size)));

  function analyze(candles, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const n = candles.length;
    const res = { n, swings: [], breaks: [], sweeps: [], fvgs: [], rejected: [], pending: null, state: null };
    if (options && options.ov && options.ov.blank && !options.ov.start && !(options.ov.add && options.ov.add.size)) { res.blank = true; return res; }   // estrutura apagada: à espera do ponto de partida
    if (n < 3 || (n < 10 && !hasMan(options && options.ov))) return res;   // séries curtas (ex.: anual): só com marcações manuais
    const H = (i) => candles[i].h, L = (i) => candles[i].l, C = (i) => candles[i].c;

    const pr = prep(candles, o), atr = pr.atr, volAvg = pr.volAvg;
    const fvgs = o.ov && o.ov.ignFvg && o.ov.ignFvg.size ? pr.fvgs.filter((f) => !o.ov.ignFvg.has(candles[f.mid].t)) : pr.fvgs;   // FVGs ignorados à mão
    res.fvgs = fvgs;
    const disp = makeDisp(candles, atr, fvgs, o);
    let pend = null, block = null;   // quebra à espera de displacement; nível bloqueado após rejeição
    const ov = o.ov || null, T = (i) => candles[i].t;
    const forcedNo = (i) => !!(ov && ov.noBreak && ov.noBreak.has(T(i)));
    const forcedYes = (i) => !!(ov && ov.yesBreak && ov.yesBreak.has(T(i)));
    const tagWhy = (w) => { const b = res.breaks[res.breaks.length - 1]; if (b) b.why = w; };

    const isPH = (i) => { if (i - o.pivotLen < 0 || i + o.pivotLen >= n) return false;
      for (let k = 1; k <= o.pivotLen; k++) { if (H(i - k) >= H(i) || H(i + k) > H(i)) return false; } return true; };
    const isPL = (i) => { if (i - o.pivotLen < 0 || i + o.pivotLen >= n) return false;
      for (let k = 1; k <= o.pivotLen; k++) { if (L(i - k) <= L(i) || L(i + k) < L(i)) return false; } return true; };
    // pontos ignorados à mão: essas velas não podem ser topo/fundo estrutural (o extremo passa para a vela seguinte mais alta/baixa)
    const ignP = (i) => !!(o.ov && o.ov.ign && o.ov.ign.size && o.ov.ign.has(candles[i].t));
    const lowest = (a, b) => { let m = -1; for (let i = a; i <= b; i++) if (!ignP(i) && (m < 0 || L(i) < L(m))) m = i; if (m < 0) m = a; return { p: L(m), i: m }; };
    const highest = (a, b) => { let m = -1; for (let i = a; i <= b; i++) if (!ignP(i) && (m < 0 || H(i) > H(m))) m = i; if (m < 0) m = a; return { p: H(m), i: m }; };
    const lowestRaw = (a, b) => { let m = a; for (let i = a; i <= b; i++) if (L(i) < L(m)) m = i; return { p: L(m), i: m }; };
    const highestRaw = (a, b) => { let m = a; for (let i = a; i <= b; i++) if (H(i) > H(m)) m = i; return { p: H(m), i: m }; };

    let trend = 0, kind = null;      // trend: 1 ascendente, -1 descendente; kind: 'BOS' | 'CHoCH'
    let prot = null;                 // nível protegido (fecho para lá dele inverte a estrutura)
    let ext = null;                  // extremo da perna atual (topo F numa subida, fundo numa descida)
    let target = null;               // nível que tem de ser quebrado para continuar a tendência
    let lastPH = null, lastPL = null, lastBroken = null;
    let cntWith = 0, cntAgainst = 0;
    let counter = null;              // extremo contrário desde o topo/fundo da perna (mede o recuo)
    const sweptLevels = new Set();
    const swing = (type, pt) => { if (!res.swings.some((s) => s.i === pt.i && s.type === type)) res.swings.push({ type, i: pt.i, p: pt.p }); };
    const addBreak = (type, dir, level, from, conf, i0) => {
      const i = i0 == null ? conf - o.confirm + 1 : i0;
      res.breaks.push({ type, dir, level, from, i, conf });
      lastBroken = level;
    };

    // trace: estado vela a vela (só com informação disponível até essa vela) — usado no teste histórico
    if (o.trace) res.trace = new Array(n);
    const rec = (j) => { res.trace[j] = { trend, kind, prot: prot && { p: prot.p, i: prot.i }, ext: ext && { p: ext.p, i: ext.i }, lb: res.breaks[res.breaks.length - 1] || null }; };
    const ms = manualSetup(candles, ov), s0 = ms.s0;
    const firstClose = (lvl, dir, a, b) => { for (let q = a; q <= b; q++) if (dir === 1 ? C(q) > lvl : C(q) < lvl) return q; return b; };
    let lastManH = null, lastManL = null;
    const lastMarked = !!(ov && ov.add && n > 0 && ov.add.has(T(n - 1)));   // marcação manual na última vela fechada
    for (let j = 0; j < n + (lastMarked ? 1 : 0); j++) {
      if (o.trace && j > 0) rec(j - 1);
      if (s0 >= 0 && j <= s0) {          // antes do ponto de partida não há estrutura
        if (j === s0) {
          const pt = ms.side === 'H' ? { p: H(j), i: j } : { p: L(j), i: j };
          res.swings.push({ type: ms.side, i: j, p: pt.p, manual: true, manualLabel: ms.label || 'Início', start: true });
          if (ms.side === 'H') { lastPH = pt; lastManH = pt; } else { lastPL = pt; lastManL = pt; }
          // o início já diz o sentido: num fundo começa a subir, num topo começa a descer (protegido no próprio início)
          trend = ms.side === 'H' ? -1 : 1; prot = pt; ext = pt; target = null; counter = null; kind = null;
        }
        continue;
      }
      // 0) swing marcado à mão na vela anterior
      if (ov && ov.add && j >= 1 && ov.add.has(T(j - 1)) && (s0 < 0 || j - 1 > s0)) {
        const k = j - 1, lab = ov.add.get(T(k));
        const top = lab === 'HH' || lab === 'LH' || lab === 'H';
        const nd = lab === 'HH' || lab === 'HL' ? 1 : lab === 'LH' || lab === 'LL' ? -1 : (top ? 1 : -1);
        const pt = top ? { p: H(k), i: k } : { p: L(k), i: k };
        const was = trend;
        if (lab === 'HH' || lab === 'LL') {
          const ref = was === nd && target && target.i < k ? target : null;   // só um topo/fundo já confirmado conta como nível quebrado; a perna em curso não
          if (was === -nd && prot && nd * (pt.p - prot.p) > 0) {
            res.breaks.push({ type: 'CHoCH', dir: nd, level: prot.p, from: prot.i, i: firstClose(prot.p, nd, prot.i + 1, k), conf: Math.min(j, n - 1), manual: true, why: 'manual', mark: T(k) });
            lastBroken = prot.p; kind = 'CHoCH';
          } else if (ref && ref.i < k && nd * (pt.p - ref.p) > 0) {
            res.breaks.push({ type: 'BOS', dir: nd, level: ref.p, from: ref.i, i: firstClose(ref.p, nd, ref.i + 1, k), conf: Math.min(j, n - 1), manual: true, why: 'manual', mark: T(k) });
            lastBroken = ref.p; kind = 'BOS';
          } else kind = was === -nd ? 'CHoCH' : (kind || 'BOS');
          // novo nível protegido: o fundo (topo) marcado à mão desde a referência anterior, senão o extremo contrário
          const from = Math.max(0, s0, ref ? ref.i : prot ? prot.i : 0);
          const manOpp = nd === 1 ? lastManL : lastManH;
          let np = manOpp && manOpp.i >= from && manOpp.i < k ? manOpp : (k > from ? (nd === 1 ? lowest(from, k - 1) : highest(from, k - 1)) : null);
          if (np) { if (!(manOpp && np === manOpp)) swing(nd === 1 ? 'L' : 'H', np); prot = np; }
          else if (!prot) prot = nd === 1 ? { p: L(k), i: k } : { p: H(k), i: k };
          trend = nd; ext = { p: pt.p, i: k }; target = { p: pt.p, i: k }; counter = null;
        } else {
          if (was !== nd) kind = was ? 'CHoCH' : 'BOS';
          const prevExt = was === nd && ext && ext.i < k ? ext : (was === nd ? target : null);
          trend = nd; prot = pt;
          target = prevExt ? { p: prevExt.p, i: prevExt.i } : null;
          ext = nd === 1 ? highest(k, j - 1 >= k ? j - 1 : k) : lowest(k, j - 1 >= k ? j - 1 : k); counter = null;
          // HL/LH marcado antes de o topo/fundo da perna ser ultrapassado: a perna continua a ir até esse topo/fundo
          if (prevExt && (nd === 1 ? prevExt.p > ext.p : prevExt.p < ext.p)) ext = { p: prevExt.p, i: prevExt.i };
        }
        const ex = res.swings.findIndex((s) => s.i === k && s.type === (top ? 'H' : 'L'));
        if (ex >= 0) res.swings.splice(ex, 1);
        res.swings.push({ type: top ? 'H' : 'L', i: k, p: pt.p, conf: Math.min(j, n - 1), manual: true, manualLabel: lab.length === 2 ? lab : null });
        if (top) lastManH = pt; else lastManL = pt;
        pend = null; block = null; cntWith = cntAgainst = 0;
      }
      if (j === n) break;   // vela extra só para fechar uma marcação manual na última vela fechada
      // 1) atualizar o extremo da perna
      const frozen = ms.manAt(j);   // troço manual: o extremo da perna fica nas tuas marcas
      if (trend === 1 && !frozen) { if (H(j) > ext.p) { ext = { p: H(j), i: j }; counter = L(j); } else counter = Math.min(counter == null ? L(j) : counter, L(j)); }
      if (trend === -1 && !frozen) { if (L(j) < ext.p) { ext = { p: L(j), i: j }; counter = H(j); } else counter = Math.max(counter == null ? H(j) : counter, H(j)); }
      // 2) pivots (só para o arranque) e fixação do alvo após o recuo começar
      const pv = j - o.pivotLen;
      if (pv > s0 && pv >= 0 && !ignP(pv)) { if (isPH(pv)) lastPH = { p: H(pv), i: pv }; if (isPL(pv)) lastPL = { p: L(pv), i: pv }; }
      if (trend !== 0 && !target && j - ext.i >= o.lockBars && !ignP(ext.i) && !ms.manAt(j)) {   // topo/fundo ignorado: não é alvo de quebra

        const a = atr[ext.i] || atr[j] || 0;
        const retr = counter == null ? 0 : Math.abs(ext.p - counter);
        const need = !(o.legRatio > 0) ? o.minRetraceAtr * a
          : Math.max((o.floorAtr == null ? 1 : o.floorAtr) * a, Math.min(o.minRetraceAtr * a, o.legRatio * Math.abs(ext.p - (prot ? prot.p : ext.p))));
        if (retr >= need) target = { p: ext.p, i: ext.i };
      }

      if (ms.manAt(j)) continue;   // troço manual: só as marcas do utilizador
      // 3) arranque
      if (trend === 0) {
        if (lastPH && C(j) > lastPH.p) {
          const pl = lowest(lastPH.i, j); swing('H', lastPH); swing('L', pl);
          trend = 1; kind = 'BOS'; prot = pl; ext = highest(pl.i, j); target = null; counter = null;
          res.breaks.push({ type: 'BOS', dir: 1, level: lastPH.p, from: lastPH.i, i: j, conf: j, init: true }); lastBroken = lastPH.p;
        } else if (lastPL && C(j) < lastPL.p) {
          const ph = highest(lastPL.i, j); swing('L', lastPL); swing('H', ph);
          trend = -1; kind = 'BOS'; prot = ph; ext = lowest(ph.i, j); target = null; counter = null;
          res.breaks.push({ type: 'BOS', dir: -1, level: lastPL.p, from: lastPL.i, i: j, conf: j, init: true }); lastBroken = lastPL.p;
        }
        continue;
      }

      const d = trend;
      // sweeps: a wick passa o nível mas o corpo fecha para dentro
      const beyond = (lvl, dir, x) => (dir === 1 ? x > lvl : x < lvl);
      if (target && beyond(target.p, d, d === 1 ? H(j) : L(j)) && !beyond(target.p, d, C(j))) {
        const key = 't' + target.i; if (!sweptLevels.has(key)) { sweptLevels.add(key); res.sweeps.push({ dir: d, level: target.p, from: target.i, i: j, what: 'extremo' }); }
      }
      if (beyond(prot.p, -d, d === 1 ? L(j) : H(j)) && !beyond(prot.p, -d, C(j))) {
        const key = 'p' + prot.i; if (!sweptLevels.has(key)) { sweptLevels.add(key); res.sweeps.push({ dir: -d, level: prot.p, from: prot.i, i: j, what: 'protegido' }); }
      }

      const doCHoCH = (i0) => {             // CHoCH: a estrutura inverte
        // topo/fundo ignorado à mão: não aparece como ponto, mas o preço continua a ser a origem da nova tendência
        if (!ignP(ext.i)) swing(d === 1 ? 'H' : 'L', ext);
        addBreak('CHoCH', -d, prot.p, prot.i, j, i0);
        trend = -d; kind = 'CHoCH';
        prot = ext;
        const a2 = Math.min(prot.i + 1, j);
        ext = trend === 1 ? highest(a2, j) : lowest(a2, j);
        target = null; cntAgainst = cntWith = 0; counter = null;
        return true;
      };
      const doBOS = (i0) => {               // BOS: a tendência continua
        const segA = ms.segs.length ? ms.segs.filter((s) => s.i <= j).slice(-1)[0] : null;   // início do troço automático atual
        const a = Math.min(Math.max(target.i + 1, segA && segA.mode === 'auto' && segA.i > s0 ? segA.i : 0), j);
        const np = d === 1 ? lowestRaw(a, j) : highestRaw(a, j);
        // o recuo que esta quebra criaria (HL/LH) foi ignorado à mão: a quebra não conta (fica como sweep)
        if (ignP(np.i)) { res.rejected.push({ type: 'BOS', dir: d, level: target.p, from: target.i, i: i0 == null ? j - o.confirm + 1 : i0, end: j, manual: true, ign: true, ignAt: np.i }); block = { dir: d, level: target.p }; cntAgainst = cntWith = 0; return false; }
        // o swing marcado é o extremo real da perna (pode ter varrido o nível com a wick)
        const top = ms.manAt(target.i) ? target : d === 1 ? highest(target.i, Math.max(target.i, np.i - 1)) : lowest(target.i, Math.max(target.i, np.i - 1));
        swing(d === 1 ? 'H' : 'L', top); swing(d === 1 ? 'L' : 'H', np);
        addBreak('BOS', d, target.p, target.i, j, i0);
        kind = 'BOS'; prot = np;
        ext = d === 1 ? highest(np.i, j) : lowest(np.i, j);
        target = null; cntAgainst = cntWith = 0; counter = null;
        return true;
      };

      // quebra à espera de displacement
      if (pend) {
        const st = forcedYes(pend.i) ? 'ok' : disp(pend.dir, pend.level, pend.i, j);
        if (st === 'ok') { const w = forcedYes(pend.i) ? 'manual' : disp.why; const okB = pend.type === 'CHoCH' ? doCHoCH(pend.i) : target ? doBOS(pend.i) : false; if (okB) tagWhy(w); pend = null; continue; }
        if (st === 'wait') continue;
        res.rejected.push(Object.assign({ end: j }, pend)); block = { dir: pend.dir, level: pend.level }; pend = null;
      }
      if (block && !beyond(block.level, block.dir, C(j))) block = null;   // voltou para dentro: o nível pode voltar a ser quebrado

      const blocked = (lvl, dir) => block && block.dir === dir && block.level === lvl;
      cntAgainst = beyond(prot.p, -d, C(j)) && !blocked(prot.p, -d) ? cntAgainst + 1 : 0;
      cntWith = target && beyond(target.p, d, C(j)) && !blocked(target.p, d) ? cntWith + 1 : 0;

      const trigger = (type, dir, level, from) => {
        const i0 = j - o.confirm + 1;
        // nível marcado como "não foi quebrado" (ignoraste o HH/LL que essa quebra criava): nunca conta enquanto for este o nível
        const lk = T(from) + '|' + dir;
        const lkFull = ov && ov.noLvl && [...ov.noLvl].find((s) => s === lk || s.startsWith(lk + '|'));
        if (lkFull) {
          const last = res.rejected[res.rejected.length - 1];
          if (last && last.lvl === lkFull) last.end = j; else res.rejected.push({ type, dir, level, from, i: i0, end: j, manual: true, lvl: lkFull });
          if (type === 'BOS' && target && !ignP(target.i)) swing(dir === 1 ? 'H' : 'L', target);   // o nível continua a ser um ponto da estrutura
          block = { dir, level }; cntAgainst = cntWith = 0; return;
        }
        if (forcedNo(i0)) { res.rejected.push({ type, dir, level, from, i: i0, end: j, manual: true }); block = { dir, level }; cntAgainst = cntWith = 0; return; }
        if (forcedYes(i0) || !o.requireDisp) { const okB = type === 'CHoCH' ? doCHoCH(i0) : doBOS(i0); if (okB && forcedYes(i0)) res.breaks[res.breaks.length - 1].manual = true; return; }
        const st = disp(dir, level, i0, j);
        if (st === 'ok') { const w = disp.why; const okB = type === 'CHoCH' ? doCHoCH(i0) : doBOS(i0); if (okB) tagWhy(w); return; }
        const pd = { type, dir, level, from, i: i0 };
        if (st === 'wait') pend = pd;
        else { res.rejected.push(Object.assign({ end: j }, pd)); block = { dir, level }; }
        cntAgainst = cntWith = 0;
      };
      if (cntAgainst >= o.confirm) trigger('CHoCH', -d, prot.p, prot.i);
      else if (cntWith >= o.confirm) trigger('BOS', d, target.p, target.i);
    }

    if (o.trace && n) rec(n - 1);
    if (pend) res.pending = Object.assign({ waited: n - 1 - pend.i, left: o.contBars - (n - 1 - pend.i) }, pend);
    // o extremo da perna já confirmado pelo recuo (alvo) também é um swing, mesmo antes de ser quebrado
    res.segs = ms.segs;
    if (target && !ms.lastIsMan && !res.swings.some((s) => s.i === target.i)) res.swings.push({ type: trend === 1 ? 'H' : 'L', i: target.i, p: target.p, provisional: true });
    labelStructural(res.swings, res.breaks);   // um fundo abaixo do anterior só é LL se houve quebra (senão foi sweep: HL)
    enrich(res, candles, atr, volAvg, o);
    res.state = { trend, kind, prot, ext, target, lastBroken };
    markInvalidSweeps(res);
    return res;
  }


  function prep(candles, o) {
    const n = candles.length;
    const H = (i) => candles[i].h, L = (i) => candles[i].l, C = (i) => candles[i].c;
    // ATR (Wilder) e média de volume das velas anteriores
    const atr = new Array(n).fill(null), volAvg = new Array(n).fill(null);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const tr = i === 0 ? H(i) - L(i) : Math.max(H(i) - L(i), Math.abs(H(i) - C(i - 1)), Math.abs(L(i) - C(i - 1)));
      if (i < o.atrLen) { acc += tr; if (i === o.atrLen - 1) atr[i] = acc / o.atrLen; }
      else atr[i] = (atr[i - 1] * (o.atrLen - 1) + tr) / o.atrLen;
    }
    let vs = 0;
    for (let i = 0; i < n; i++) {
      if (i >= o.volLen) volAvg[i] = vs / o.volLen;
      vs += candles[i].v || 0;
      if (i >= o.volLen) vs -= candles[i - o.volLen].v || 0;
    }
    // Fair value gaps (padrão de 3 velas) e respetivo preenchimento
    const fvgs = [];
    for (let i = 2; i < n; i++) {
      if (L(i) > H(i - 2)) fvgs.push({ dir: 1, top: L(i), bot: H(i - 2), mid: i - 1, created: i });
      if (H(i) < L(i - 2)) fvgs.push({ dir: -1, top: L(i - 2), bot: H(i), mid: i - 1, created: i });
    }
    for (const f of fvgs) {
      f.filled = null; f.touched = false;
      for (let j = f.created + 1; j < n; j++) {
        if (f.dir === 1) { if (L(j) <= f.top) f.touched = true; if (L(j) <= f.bot) { f.filled = j; break; } }
        else { if (H(j) >= f.bot) f.touched = true; if (H(j) >= f.top) { f.filled = j; break; } }
      }
    }
    return { atr, volAvg, fvgs };
  }

  // rótulos HH/HL/LH/LL

  // ponto de partida manual e zona manual (do início até à última marca só contam as marcas do utilizador)
  // ponto de partida e modos (manual / automático) por troços: cada troço vai de uma mudança de modo até à seguinte
  function manualSetup(candles, ov) {
    const n = candles.length, r = { s0: -1, side: null, lastMan: -1, label: null, segs: [], manAt: () => false };
    if (!ov) return r;
    const idxOf = (t) => { let lo = 0, hi = n - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (candles[m].t === t) return m; if (candles[m].t < t) lo = m + 1; else hi = m - 1; } return -1; };
    const firstAtOrAfter = (t) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (candles[m].t < t) lo = m + 1; else hi = m; } return lo; };
    let mode0 = null;
    if (ov.start && ov.start.t != null) {
      const k = idxOf(ov.start.t);
      if (k >= 0 && k < n - 1) { r.s0 = k; r.side = ov.start.side === 'H' ? 'H' : 'L'; mode0 = ov.start.mode || 'legacy'; }
    }
    // estrutura apagada e o utilizador marcou pontos sem escolher o início: a primeira marca passa a ser o início (manual)
    if (r.s0 < 0 && ov.blank && ov.add && ov.add.size) {
      for (let i = 0; i < n - 1; i++) if (ov.add.has(candles[i].t)) { const lab = ov.add.get(candles[i].t); r.s0 = i; r.side = lab === 'HH' || lab === 'LH' || lab === 'H' ? 'H' : 'L'; r.label = lab.length === 2 ? lab : null; mode0 = 'man'; break; }
    }
    if (r.s0 < 0) return r;
    if (ov.add) for (let i = r.s0 + 1; i < n; i++) if (ov.add.has(candles[i].t)) r.lastMan = i;
    // troços: o início abre o primeiro; cada mudança de modo (depois do início) abre o seguinte
    const segs = [];
    if (mode0 === 'legacy') { if (r.lastMan < 0) segs.push({ i: r.s0, mode: 'auto' }); else { segs.push({ i: r.s0, mode: 'man' }); if (r.lastMan + 1 < n) segs.push({ i: r.lastMan + 1, mode: 'auto', implicit: true }); } }
    else segs.push({ i: r.s0, mode: mode0 });
    if (mode0 !== 'legacy' && ov.modes && ov.modes.length) {
      for (const m of ov.modes.slice().sort((a, b) => a.t - b.t)) { const i = firstAtOrAfter(m.t); if (i > r.s0 && i < n) segs.push({ i, mode: m.mode === 'man' ? 'man' : 'auto' }); }
    }
    r.segs = segs;
    const modeAt = (j) => { let md = null; for (const s of r.segs) { if (s.i <= j) md = s.mode; else break; } return md; };
    r.manAt = (j) => j >= r.s0 && modeAt(j) === 'man';
    r.lastIsMan = r.segs.length ? r.segs[r.segs.length - 1].mode === 'man' : false;
    return r;
  }

  function labelSwings(swings) {
    swings.sort((a, b) => a.i - b.i);
    let pH = null, pL = null;
    for (const s of swings) {
      if (s.manualLabel) { s.label = s.manualLabel; if (s.type === 'H') pH = s.p; else pL = s.p; continue; }
      if (s.type === 'H') { s.label = pH == null ? 'H' : s.p > pH ? 'HH' : 'LH'; pH = s.p; }
      else { s.label = pL == null ? 'L' : s.p < pL ? 'LL' : 'HL'; pL = s.p; }
    }
  }

  // rótulos estruturais: um topo acima do anterior só é HH se houve quebra aceite na perna (ou a tendência já era de subida);
  // se só passou por sweep / quebra falhada numa descida, continua a ser LH. Espelho para os fundos.
  function labelStructural(swings, breaks) {
    swings.sort((a, b) => a.i - b.i);
    const trendAt0 = (i) => { let t = 0, bi = -1; for (const b of breaks) if (b.i <= i && b.i >= bi) { t = b.dir; bi = b.i; } return t; };
    // leitura retroativa: quando uma viragem (CHoCH) é aceite, os swings desde o extremo de onde partiu essa perna
    // até à quebra já pertencem ao movimento novo (ex.: fundos cada vez mais baixos antes do CHoCH ▼ são LL, não HL)
    const retro = [];
    const bs = breaks.slice().sort((a, b) => a.i - b.i);
    bs.forEach((b, n) => {
      if (b.type !== 'CHoCH') return;
      const prevI = n > 0 ? bs[n - 1].i : -1;
      let org = null;
      for (const s of swings) if (s.i > prevI && s.i < b.i && s.type === (b.dir === -1 ? 'H' : 'L') && (!org || (b.dir === -1 ? s.p > org.p : s.p < org.p))) org = s;
      if (org) retro.push({ from: org.i, to: b.i, dir: b.dir });
    });
    const trendAt = (i) => { for (const r of retro) if (i > r.from && i < r.to) return r.dir; return trendAt0(i); };
    let pH = null, pL = null, lastOpp = { H: null, L: null };
    for (const s of swings) {
      const legStart = s.type === 'H' ? lastOpp.L : lastOpp.H;
      if (s.manualLabel) { s.label = s.manualLabel; if (s.type === 'H') { pH = s.p; lastOpp.H = s.i; } else { pL = s.p; lastOpp.L = s.i; } continue; }
      if (s.type === 'H') {
        if (pH == null) s.label = 'H';
        else if (s.p > pH) {
          const brk = breaks.some((b) => b.dir === 1 && b.i <= s.i && (legStart == null || b.i > legStart));
          s.label = brk || trendAt(s.i) === 1 ? 'HH' : 'LH';
        } else s.label = 'LH';
        pH = s.p; lastOpp.H = s.i;
      } else {
        if (pL == null) s.label = 'L';
        else if (s.p < pL) {
          const brk = breaks.some((b) => b.dir === -1 && b.i <= s.i && (legStart == null || b.i > legStart));
          s.label = brk || trendAt(s.i) === -1 ? 'LL' : 'HL';
        } else s.label = 'HL';
        pL = s.p; lastOpp.L = s.i;
      }
    }
  }

  // detalhe de cada quebra: FVG, volume, tipo de vela
  // sweep invalidado: o mesmo nível acabou por ser quebrado (no mesmo sentido) depois do sweep — afinal não foi recolha de liquidez
  function markInvalidSweeps(res) {
    for (const sw of res.sweeps) sw.invalid = res.breaks.some((b) => b.dir === sw.dir && b.i >= sw.i && b.dir * (b.level - sw.level) >= -1e-9 * Math.abs(sw.level));   // quebra posterior no mesmo sentido, nesse nível ou para lá dele
  }
  function enrich(res, candles, atr, volAvg, o) {
    const n = candles.length;
    for (const b of res.breaks) {
      const i = b.i, c = candles[i];
      const f = res.fvgs.find((x) => x.dir === b.dir && x.mid >= i - 1 && x.mid <= Math.max(i, b.conf || i) + 1);   // FVG criado pela quebra (até à vela que a confirmou)
      b.fvg = f ? 'sim' : i + 2 >= n ? 'pendente' : 'não';
      b.volRatio = volAvg[i] ? (c.v || 0) / volAvg[i] : null;
      b.volume = b.volRatio == null ? '—' : b.volRatio >= o.volMult ? 'sim' : 'não';
      const body = Math.abs(c.c - c.o), range = c.h - c.l || 1e-12;
      b.bodyAtr = atr[i] ? body / atr[i] : null;
      b.candle = b.bodyAtr == null ? '—' : b.bodyAtr >= 1.0 && body / range >= 0.6 ? 'forte' : b.bodyAtr < 0.5 ? 'fraca' : 'normal';
      // a que distância do nível quebrado fechou a vela da quebra (em ATR); abaixo da margem = fecho colado
      b.closeAtr = atr[i] && b.level != null ? b.dir * (c.c - b.level) / atr[i] : null;
      b.closeTight = b.closeAtr != null && b.closeAtr < (o.closeMarginAtr || 0.3);
    }
  }

  // MOVIMENTO RECENTE: segue sempre os swings mais recentes.
  // Swings: zigzag — um topo/fundo fica confirmado quando o preço recua pelo menos minRetraceAtr x ATR.
  // Numa descida, vira para cima com fecho acima do último topo; numa subida, vira para baixo com fecho abaixo do último fundo.
  function analyzeRecent(candles, options) {
    const o = Object.assign({}, DEFAULTS, { minRetraceAtr: 2 }, options || {});
    const n = candles.length;
    const res = { n, swings: [], breaks: [], sweeps: [], fvgs: [], rejected: [], pending: null, state: null };
    if (options && options.ov && options.ov.blank && !options.ov.start && !(options.ov.add && options.ov.add.size)) { res.blank = true; return res; }   // estrutura apagada: à espera do ponto de partida
    if (n < 3 || (n < 20 && !hasMan(options && options.ov))) return res;
    const H = (i) => candles[i].h, L = (i) => candles[i].l, C = (i) => candles[i].c;
    const pr = prep(candles, o), atr = pr.atr, volAvg = pr.volAvg;
    const fvgs = o.ov && o.ov.ignFvg && o.ov.ignFvg.size ? pr.fvgs.filter((f) => !o.ov.ignFvg.has(candles[f.mid].t)) : pr.fvgs;   // FVGs ignorados à mão
    res.fvgs = fvgs;
    const disp = makeDisp(candles, atr, fvgs, o);
    let pend = null;   // quebra à espera de displacement
    // quebra em disputa: fechou claramente para lá do nível mas não foi aceite / falhou.
    // resolve-se pelo que o preço faz a seguir: fecho para lá do extremo da perna que quebrou = a quebra era real (conta desde a vela original);
    // fecho para lá do extremo do outro lado da perna = era mesmo sweep
    let dispute = null;
    let watch = null;  // última quebra, vigiada durante failBars velas
    // correções manuais (por hora da vela): ignorar swing, marcar swing, "não é quebra", "é quebra"
    const ov = o.ov || null, T = (i) => candles[i].t;
    const ignored = (i) => !!(ov && ov.ign && ov.ign.has(T(i)));
    const forcedNo = (i) => !!(ov && ov.noBreak && ov.noBreak.has(T(i)));
    const forcedYes = (i) => !!(ov && ov.yesBreak && ov.yesBreak.has(T(i)));
    const lowest = (a, b) => { let m = a; for (let i = a; i <= b; i++) if (L(i) < L(m)) m = i; return { p: L(m), i: m }; };
    const highest = (a, b) => { let m = a; for (let i = a; i <= b; i++) if (H(i) > H(m)) m = i; return { p: H(m), i: m }; };
    // swing: recuo >= legRatio x perna, mas nunca menos de floorAtr x ATR nem mais de minRetraceAtr x ATR (ATR insuflado em tendências fortes)
    const thr = (i, j, leg) => {
      const a = atr[i] || atr[j] || (H(j) - L(j));
      if (!(o.legRatio > 0)) return o.minRetraceAtr * a;
      return Math.max((o.floorAtr == null ? 1 : o.floorAtr) * a, Math.min(o.minRetraceAtr * a, o.legRatio * Math.abs(leg)));
    };
    let zLastH = H(0), zLastL = L(0);   // últimos pontos do zigzag (origem da perna atual)
    // o extremo da perna que quebrou estrutura é um ponto estrutural: basta o recuo mínimo (floorAtr) para contar como swing
    const flo = (i, j) => (o.floorAtr == null ? 1 : o.floorAtr) * (atr[i] || atr[j] || (H(j) - L(j)));
    const brk = (dir, p) => o.breakSwing !== false && o.legRatio > 0 && trend === dir && lastBroken != null && dir * (p - lastBroken) > 0;

    let zdir = 0, hi = { p: H(0), i: 0 }, lo = { p: L(0), i: 0 };
    let lastSH = null, lastSL = null;
    let trend = 0, kind = null, lastBroken = null, cntUp = 0, cntDn = 0;

    // trace: estado vela a vela (causal) — usado no teste histórico
    const allBreaks = [];
    if (o.trace) res.trace = new Array(n);
    let tCache = null;
    const rec = (j) => {
      if (!trend) { res.trace[j] = { trend: 0 }; return; }
      const lb = res.breaks[res.breaks.length - 1];
      let pr = trend === 1 ? lastSL : lastSH;
      if (!pr || pr.broken || (lb && pr.i < lb.from)) pr = lb ? (trend === 1 ? lowest(lb.from, j) : highest(lb.from, j)) : null;
      if (!pr) { res.trace[j] = { trend: 0 }; return; }
      let ex;
      if (tCache && tCache.pi === pr.i && tCache.pp === pr.p && tCache.t === trend && tCache.j === j - 1) ex = trend === 1 ? (H(j) > tCache.ex.p ? { p: H(j), i: j } : tCache.ex) : (L(j) < tCache.ex.p ? { p: L(j), i: j } : tCache.ex);
      else ex = trend === 1 ? highest(pr.i, j) : lowest(pr.i, j);
      tCache = { pi: pr.i, pp: pr.p, t: trend, j, ex };
      res.trace[j] = { trend, kind, prot: { p: pr.p, i: pr.i }, ext: ex, lb: lb || null, pend: pend ? { dir: pend.dir, i: pend.i } : null };
    };
    const ms = manualSetup(candles, ov), s0 = ms.s0;
    const lastMarked = !!(ov && ov.add && n > 0 && ov.add.has(T(n - 1)));
    for (let j = 1; j < n + (lastMarked ? 1 : 0); j++) {
      if (o.trace && j > 1) rec(j - 1);
      if (s0 >= 0 && j <= s0) {          // antes do ponto de partida não há estrutura
        if (j === s0) {
          if (ms.side === 'H') { res.swings.push({ type: 'H', i: j, p: H(j), conf: j, manual: true, manualLabel: ms.label || 'Início', start: true }); lastSH = { p: H(j), i: j, broken: false, swept: false }; zdir = -1; zLastH = H(j); trend = -1; }
          else { res.swings.push({ type: 'L', i: j, p: L(j), conf: j, manual: true, manualLabel: ms.label || 'Início', start: true }); lastSL = { p: L(j), i: j, broken: false, swept: false }; zdir = 1; zLastL = L(j); trend = 1; }
          hi = { p: H(j), i: j }; lo = { p: L(j), i: j };
        }
        continue;
      }
      const manZone = ms.manAt(j);   // troço manual: o scanner não cria swings nem quebras
      // 0) swing marcado à mão na vela anterior
      if (ov && ov.add && ov.add.has(T(j - 1)) && (s0 < 0 || j - 1 > s0)) {
        const k = j - 1, lab = ov.add.get(T(k)), isH = lab === 'H' || lab === 'HH' || lab === 'LH';
        const manualLabel = lab.length === 2 ? lab : null;
        // HH / LL marcados à mão: a estrutura quebra (na 1.ª vela que fechou para lá do swing anterior)
        const force = (dir) => {
          const prev = dir === 1 ? lastSH : lastSL;
          let level, from, bi = k;
          if (prev && (dir === 1 ? H(k) > prev.p : L(k) < prev.p)) {
            level = prev.p; from = prev.i;
            for (let q = prev.i + 1; q <= k; q++) if (dir === 1 ? C(q) > level : C(q) < level) { bi = q; break; }
            prev.broken = true;
          } else { trend = dir; kind = trend === -dir ? 'CHoCH' : (kind || 'BOS'); pend = null; watch = null; cntUp = cntDn = 0; return; }   // nada para quebrar: só define o sentido
          const type = trend === -dir ? 'CHoCH' : 'BOS';
          const dup = res.breaks.find((b) => b.dir === dir && b.level === level);   // a quebra já tinha sido detetada: não duplicar
          if (dup) { trend = dir; kind = dup.type; lastBroken = level; pend = null; watch = null; cntUp = cntDn = 0; return; }
          res.breaks.push({ type, dir, level, from, i: bi, conf: Math.min(j, n - 1), manual: true, why: 'manual', mark: T(k) }); allBreaks.push(res.breaks[res.breaks.length - 1]);
          trend = dir; kind = type; lastBroken = level; pend = null; watch = null; cntUp = cntDn = 0;
        };
        if (isH) {
          if (lab === 'HH') force(1);
          res.swings.push({ type: 'H', i: k, p: H(k), conf: Math.min(j, n - 1), manual: true, manualLabel });
          lastSH = { p: H(k), i: k, broken: false, swept: false }; cntUp = 0; zdir = -1; lo = lowest(Math.min(k + 1, j, n - 1), Math.min(j, n - 1)); zLastH = H(k);
        } else {
          if (lab === 'LL') force(-1);
          res.swings.push({ type: 'L', i: k, p: L(k), conf: Math.min(j, n - 1), manual: true, manualLabel });
          lastSL = { p: L(k), i: k, broken: false, swept: false }; cntDn = 0; zdir = 1; hi = highest(Math.min(k + 1, j, n - 1), Math.min(j, n - 1)); zLastL = L(k);
        }
      }
      if (j === n) break;
      // 1) zigzag
      if (!manZone && zdir >= 0 && H(j) > hi.p) hi = { p: H(j), i: j };
      if (!manZone && zdir <= 0 && L(j) < lo.p) lo = { p: L(j), i: j };
      const isManual = (i) => !!(ov && ov.add && ov.add.has(T(i)));
      if (zdir >= 0 && j > hi.i && hi.p - L(j) >= (brk(1, hi.p) ? flo(hi.i, j) : thr(hi.i, j, hi.p - zLastL))) {
        if (!manZone && !ignored(hi.i) && !isManual(hi.i)) { res.swings.push({ type: 'H', i: hi.i, p: hi.p, conf: j }); lastSH = { p: hi.p, i: hi.i, broken: false, swept: false }; cntUp = 0; }
        zLastH = hi.p; zdir = -1; lo = lowest(hi.i + 1, j);
      } else if (zdir <= 0 && j > lo.i && H(j) - lo.p >= (brk(-1, lo.p) ? flo(lo.i, j) : thr(lo.i, j, zLastH - lo.p))) {
        if (!manZone && !ignored(lo.i) && !isManual(lo.i)) { res.swings.push({ type: 'L', i: lo.i, p: lo.p, conf: j }); lastSL = { p: lo.p, i: lo.i, broken: false, swept: false }; cntDn = 0; }
        zLastL = lo.p; zdir = 1; hi = highest(lo.i + 1, j);
      }
      // 2) quebras (fecho do corpo, com displacement se exigido) e sweeps (só a wick)
      const openDispute = (b) => {
        let far = 0; for (let q = b.i; q <= j; q++) far = Math.max(far, b.dir * (C(q) - b.level));
        if (far < o.closeMarginAtr * (atr[b.i] || 0) || b.manual) return;     // só um toque: é sweep simples
        const lo = b.dir === -1 ? lowest(b.i, j) : highest(b.i, j);
        const opp = b.dir === -1 ? highest(Math.min(b.from, b.i), b.i) : lowest(Math.min(b.from, b.i), b.i);
        dispute = { type: b.type, dir: b.dir, level: b.level, from: b.from, i: b.i, conf: j, lo: lo.p, loI: lo.i, opp: opp.p, oppI: opp.i };
      };
      const doBreak = (dir, sw, i0) => {
        dispute = null;
        const type = trend === -dir ? 'CHoCH' : 'BOS';
        res.breaks.push({ type, dir, level: sw.p, from: sw.i, i: i0, conf: j, init: trend === 0 }); allBreaks.push(res.breaks[res.breaks.length - 1]);
        // guarda o estado anterior para poder anular a quebra se ela falhar
        watch = o.failBars > 0 && !forcedYes(i0) ? { dir, level: sw.p, i: i0, prev: { trend, kind, lastBroken }, brk: res.breaks[res.breaks.length - 1] } : null;
        sw.broken = true; lastBroken = sw.p; trend = dir; kind = type; cntUp = cntDn = 0;
      };
      // quebra falhada: o preço fechou de volta para lá do nível pouco depois da quebra -> era um sweep
      if (watch && j > watch.brk.conf) {
        if (j - watch.i > o.failBars) watch = null;
        else if (watch.dir * (C(j) - watch.level) <= -o.closeMarginAtr * (atr[watch.i] || 0)) {
          const b = watch.brk, k = res.breaks.indexOf(b);
          if (k >= 0) res.breaks.splice(k, 1);
          res.rejected.push({ type: b.type, dir: b.dir, level: b.level, from: b.from, i: b.i, end: j, failed: true });
          res.sweeps.push({ dir: b.dir, level: b.level, from: b.from, i: b.i, at: j, failed: true });
          trend = watch.prev.trend; kind = watch.prev.kind; lastBroken = watch.prev.lastBroken; cntUp = cntDn = 0;
          watch = null; openDispute(b);
        }
      }
      if (dispute && forcedNo(dispute.i)) dispute = null;   // marcada como sweep: não volta a contar
      if (dispute && j > dispute.conf && !manZone) {
        if (dispute.dir * (C(j) - dispute.lo) > 0) {          // a quebra confirmou-se: conta desde a vela original
          const b = { type: trend === -dispute.dir ? 'CHoCH' : 'BOS', dir: dispute.dir, level: dispute.level, from: dispute.from, i: dispute.i, conf: j, why: 'confirmada depois' };
          res.breaks.push(b); allBreaks.push(b);
          const k = res.rejected.findIndex((r) => r.i === dispute.i && r.level === dispute.level); if (k >= 0) res.rejected.splice(k, 1);
          trend = dispute.dir; kind = b.type; lastBroken = dispute.level; cntUp = cntDn = 0; pend = null; watch = null; dispute = null;
        } else if (-dispute.dir * (C(j) - dispute.opp) > 0) dispute = null;   // era mesmo sweep
      }
      if (pend) {
        const sw = pend.dir === 1 ? lastSH : lastSL;
        if (sw !== pend.sw || sw.broken) { const { sw: psw, ...rest } = pend; if (!psw.broken) res.rejected.push(Object.assign({ end: j }, rest)); pend = null; }
        else {
          const st = forcedYes(pend.i) ? 'ok' : disp(pend.dir, pend.level, pend.i, j);
          if (st === 'ok') { const w = forcedYes(pend.i) ? 'manual' : disp.why; doBreak(pend.dir, sw, pend.i); res.breaks[res.breaks.length - 1].why = w; pend = null; }
          else if (st === 'reject') { const { sw: _x, ...rest } = pend; res.rejected.push(Object.assign({ end: j }, rest)); sw.blocked = true; pend = null; openDispute(rest); }
        }
      }
      const side = (dir, sw) => {
        if (!sw || sw.broken) return;
        const beyondC = dir === 1 ? C(j) > sw.p : C(j) < sw.p;
        const beyondW = dir === 1 ? H(j) > sw.p : L(j) < sw.p;
        if (sw.blocked && !beyondC) sw.blocked = false;      // fechou de volta para dentro: pode voltar a ser quebrado
        let cnt = dir === 1 ? cntUp : cntDn;
        cnt = beyondC && !sw.blocked ? cnt + 1 : 0;
        if (!beyondC && beyondW && !sw.swept) { sw.swept = true; res.sweeps.push({ dir, level: sw.p, from: sw.i, i: j, at: j }); }
        if (dir === 1) cntUp = cnt; else cntDn = cnt;
        if (pend || cnt < o.confirm) return;
        const i0 = j - o.confirm + 1;
        const lk = T(sw.i) + '|' + dir;
        const lkFull = ov && ov.noLvl && [...ov.noLvl].find((s) => s === lk || s.startsWith(lk + '|'));
        if (lkFull) {
          const last = res.rejected[res.rejected.length - 1];
          if (last && last.lvl === lkFull) last.end = j; else res.rejected.push({ type: trend === -dir ? 'CHoCH' : 'BOS', dir, level: sw.p, from: sw.i, i: i0, end: j, manual: true, lvl: lkFull });
          sw.blocked = true; if (dir === 1) cntUp = 0; else cntDn = 0; return;
        }
        if (forcedNo(i0)) { res.rejected.push({ type: trend === -dir ? 'CHoCH' : 'BOS', dir, level: sw.p, from: sw.i, i: i0, end: j, manual: true }); sw.blocked = true; if (dir === 1) cntUp = 0; else cntDn = 0; return; }
        if (forcedYes(i0)) { doBreak(dir, sw, i0); res.breaks[res.breaks.length - 1].manual = true; return; }
        if (!o.requireDisp) return doBreak(dir, sw, i0);
        const st = disp(dir, sw.p, i0, j);
        if (st === 'ok') { const w = disp.why; doBreak(dir, sw, i0); res.breaks[res.breaks.length - 1].why = w; return; }
        const pd = { type: trend === -dir ? 'CHoCH' : 'BOS', dir, level: sw.p, from: sw.i, i: i0 };
        if (st === 'wait') pend = Object.assign({ sw }, pd);
        else { res.rejected.push(Object.assign({ end: j }, pd)); sw.blocked = true; openDispute(pd); }
        if (dir === 1) cntUp = 0; else cntDn = 0;
      };
      if (!manZone) { side(1, lastSH); side(-1, lastSL); }
    }
    if (o.trace && n > 1) rec(n - 1);
    if (pend) { const { sw: _x, ...rest } = pend; res.pending = Object.assign({ waited: n - 1 - pend.i, left: o.contBars - (n - 1 - pend.i) }, rest); }
    labelStructural(res.swings, res.breaks);
    enrich({ breaks: allBreaks, fvgs: res.fvgs }, candles, atr, volAvg, o);   // inclui quebras que depois falharam (para o trace)
    res.atr = atr[n - 1];
    res.dispute = dispute;
    res.segs = ms.segs;
    if (trend) {
      const lb = res.breaks[res.breaks.length - 1];
      // limite = último swing contrário ainda por quebrar (o "ponto 3")
      let prot = trend === 1 ? lastSL : lastSH;
      if (!prot || prot.broken || (lb && prot.i < lb.from)) prot = lb ? (trend === 1 ? lowest(lb.from, n - 1) : highest(lb.from, n - 1)) : (trend === 1 ? (lastSL || lowest(0, n - 1)) : (lastSH || highest(0, n - 1)));
      let ext = trend === 1 ? highest(prot.i, n - 1) : lowest(prot.i, n - 1);
      // topo/fundo marcado à mão antes do limite e ainda por quebrar: a perna vai até ele (não só até ao extremo depois do limite)
      const opp = trend === 1 ? lastSH : lastSL, isMan = (i) => !!(ov && ov.add && ov.add.has(T(i))) || (s0 >= 0 && i === s0);
      if (opp && !opp.broken && opp.i < prot.i && (isMan(opp.i) || isMan(prot.i)) && (trend === 1 ? opp.p > ext.p : opp.p < ext.p)) ext = { p: opp.p, i: opp.i };
      res.state = { trend, kind, prot: { p: prot.p, i: prot.i }, ext, target: null, lastBroken };
    }
    markInvalidSweeps(res);
    return res;
  }

  // Leitura atual com o preço ao vivo (a vela em formação não entra no cálculo da estrutura)
  function snapshot(res, price, nowIdx, lastClose) {
    const s = res.state;
    if (!s || !s.trend) return { label: res.blank ? 'Estrutura apagada — marca o início' : res.swings && res.swings.some((x) => x.start) ? 'Estrutura por definir' : 'Sem dados suficientes' };
    const d = s.trend;
    const ext = d === 1 ? Math.max(s.ext.p, price) : Math.min(s.ext.p, price);
    // correções medidas em escala logarítmica (como as Fibonacci em log do TradingView); linear só se houver preços ≤ 0
    const lg = ext > 0 && s.prot.p > 0 && price > 0 && s.ext.p > 0;
    const F = lg ? Math.log : (x) => x, FI = lg ? Math.exp : (x) => x;
    const retr = (e, x, p0) => { const den = F(e) - F(p0); return den ? Math.max(0, (F(e) - F(x)) / den * 100) : 0; };
    const pull = retr(ext, price, s.prot.p);
    const invalid = d === 1 ? price < s.prot.p : price > s.prot.p;
    const newExt = d === 1 ? price > s.ext.p : price < s.ext.p;
    const recentExt = nowIdx - s.ext.i <= 1;   // novo extremo numa das 2 últimas velas fechadas
    const phase = invalid ? 'A testar o limite' : (newExt || recentExt || pull < 10) ? 'Em continuação' : 'Em correção';
    const lvl = (f) => FI(F(ext) - f * (F(ext) - F(s.prot.p)));
    const lb = res.breaks[res.breaks.length - 1];
    const lastSweep = res.sweeps[res.sweeps.length - 1] || null;
    // viragem por confirmar que já devolveu metade ou mais do movimento = range
    // decidido só com o FECHO da última vela fechada (wicks não contam)
    const lc = lastClose == null ? price : lastClose;
    const pullClosed = lg && lc > 0 ? retr(s.ext.p, lc, s.prot.p) : Math.max(0, (d === 1 ? s.ext.p - lc : lc - s.ext.p) / (Math.abs(s.ext.p - s.prot.p) || 1e-12) * 100);
    const isRange = s.kind === 'CHoCH' && pullClosed >= 50;
    return {
      trend: d, kind: s.kind, isRange,
      rangeLo: Math.min(s.prot.p, s.ext.p), rangeHi: Math.max(s.prot.p, s.ext.p),
      label: isRange ? 'Range' : s.kind === 'CHoCH' ? (d === 1 ? 'A virar para cima' : 'A virar para baixo') : d === 1 ? 'Subida' : 'Descida',
      phase, pullback: pull,
      fromBroken: s.lastBroken ? (price - s.lastBroken) / s.lastBroken * 100 : null,
      toInvalid: (price - s.prot.p) / price * 100,
      protected: s.prot.p, extreme: ext,
      levels: { 50: lvl(0.5), 618: lvl(0.618), 65: lvl(0.65), 786: lvl(0.786), 918: lvl(0.918) }, logScale: lg,
      lastBreak: lb ? Object.assign({ barsAgo: nowIdx - lb.i }, lb) : null,
      pending: res.pending || null,
      dispute: res.dispute ? { dir: res.dispute.dir, level: res.dispute.level, confirm: res.dispute.lo, sweep: res.dispute.opp, i: res.dispute.i, barsAgo: nowIdx - res.dispute.i } : null,
      lastSweep: lastSweep ? Object.assign({ barsAgo: nowIdx - lastSweep.i }, lastSweep) : null,
    };
  }

  const api = { analyze, analyzeRecent, snapshot, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.StructureEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);

globalThis.MSS_DEFAULTS = {"confirm":1,"lockBars":2,"extAtr":3,"intAtr":2,"prevLevels":true,"setups":[{"name":"Longo prazo","ctx":"1M","zone":"1w","trig":"4h","on":true},{"name":"Swing","ctx":"1w","zone":"1d","trig":"1h","on":true},{"name":"Day trade","ctx":"1d","zone":"4h","trig":"15m","on":true},{"name":"Scalp","ctx":"4h","zone":"1h","trig":"5m","on":true}],"btAssets":"BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT","minRR":3,"feePct":0.1,"stopBufAtr":0.1,"dispInt":true,"dispExt":false,"dispAtr":1,"contBars":3,"fvgMinAtr":0.3,"contAtr":1,"closeMarginAtr":0.3,"acceptBars":1,"failBars":4,"failByTf":"5m:6, 15m:6, 1h:6, 4h:5, 1d:2, 1w:1, 1M:1, 3M:1, 6M:1, 1Y:1","favs":[],"legRatio":0.5,"floorAtr":1.5,"dayStart":"ny","sessions":"","showDayR":true,"showWeekR":true,"showAsiaR":true,"kzOn":true,"kzAsia":true,"kzLondon":true,"kzNy":true,"liqTfs":["1M","1w","1d","4h","1h","15m"],"volMult":1.5,"recent":5,"refresh":true,"tfs":["1Y","6M","3M","1M","1w","1d","4h","1h","15m","5m"],"showExt":true,"showInt":true,"kzProfile":"cripto","showLondonR":true,"divPivot":5,"pocD":false,"pocW":false,"emaOn":false,"smaOn":false,"kcOn":false,"rangesDW":false,"theme":"dark","rangeTolByTf":"5m:3, 15m:2, 1h:1, 4h:1, 1d:1"};
// Fibonacci automáticas (em escala log), a partir da estrutura de cada timeframe.
// Fibonacci atual = da perna em curso (limite → topo/fundo): retrações (entradas) e alvos (extensões).
// Fibonacci anterior = do mesmo limite até ao topo/fundo anterior já ultrapassado: só alvos, enquanto viva.
// Morre quando o preço chega a um alvo, inverte e volta ao nível anterior (ou à linha do 0), ou fecha para lá da origem (1).
// Usado pela app (no HTML) e pelo vigia (alertas-motor.js).
(function (root) {
  'use strict';
  const ENTRY = [0.618, 0.65], DEEP = 0.786, INVAL = 0.918;
  const TGT = [[-0.236, -0.268, 'Alvo 1'], [-0.618, -0.65, 'Alvo 2'], [-1, -1.032, 'Alvo 3']];
  const NEXT = { '1Y': '6M', '6M': '3M', '3M': '1M', '1M': '1w', '1w': '1d', '1d': '4h', '4h': '1h', '1h': '15m', '15m': '5m' };
  // nível f de uma Fibonacci com 1 em A e 0 em B (negativos = para lá de B)
  const lv = (A, B, f) => (A > 0 && B > 0 ? Math.exp(Math.log(B) + f * (Math.log(A) - Math.log(B))) : B + f * (A - B));
  function make(A, B, dir, role) {
    const t = TGT.map(([f1, f2, name], k) => { const a = lv(A, B, f1), b = lv(A, B, f2); return { k, name, f: f1, lo: Math.min(a, b), hi: Math.max(a, b), near: a }; });
    return { dir, role, A, B, entry: { lo: Math.min(lv(A, B, ENTRY[0]), lv(A, B, ENTRY[1])), hi: Math.max(lv(A, B, ENTRY[0]), lv(A, B, ENTRY[1])) }, deep: lv(A, B, DEEP), inval: lv(A, B, INVAL), mid: lv(A, B, 0.5), targets: t };
  }
  // percorre as velas depois de B: alvos atingidos e se a Fibonacci morreu (regra do Richy)
  function life(f, cs, fromI) {
    const up = f.dir === 1; let hit = -1, hitJ = -1, dead = false;
    for (let j = fromI + 1; j < cs.length; j++) {
      const c = cs[j];
      if (up ? c.c < f.A : c.c > f.A) { dead = true; break; }   // fechou para lá da origem (1)
      if (hit >= 0 && j > hitJ) { const back = hit > 0 ? f.targets[hit - 1].near : f.B; if (up ? c.l <= back : c.h >= back) { dead = true; break; } }   // inverteu no alvo e voltou ao nível anterior / ao 0
      for (let k = f.targets.length - 1; k > hit; k--) if (up ? c.h >= f.targets[k].near : c.l <= f.targets[k].near) { hit = k; hitJ = j; break; }
    }
    f.targets.forEach((t) => { t.hit = t.k <= hit; });
    f.dead = dead; return f;
  }
  // as Fibonacci vivas de uma análise (res = resultado do motor; cs = velas fechadas; price = preço atual)
  function fibsOf(res, cs, price) {
    const s = res && res.state; if (!s || !s.trend || !cs || !cs.length) return [];
    const d = s.trend, A = s.prot, ext = s.ext, out = [];
    const cur = make(A.p, ext.p, d, 'atual'); cur.Ai = A.i; cur.Bi = ext.i;
    life(cur, cs, ext.i); out.push(cur);
    // topo/fundo anterior (já ultrapassado) depois do limite: Fibonacci só de alvos
    const sw = (res.swings || []).filter((x) => x.type === (d === 1 ? 'H' : 'L') && !x.provisional && x.i > A.i && x.i < ext.i && (d === 1 ? x.p < ext.p : x.p > ext.p)).sort((a, b) => b.i - a.i)[0];
    if (sw) { const pv = make(A.p, sw.p, d, 'anterior'); pv.Ai = A.i; pv.Bi = sw.i; life(pv, cs, sw.i); if (!pv.dead) out.push(pv); }
    return out;
  }
  // retração (log) de um preço numa Fibonacci: 0 em B, 1 em A
  const retrOf = (f, p) => (f.A > 0 && f.B > 0 && p > 0 ? (Math.log(f.B) - Math.log(p)) / (Math.log(f.B) - Math.log(f.A)) : (f.B - p) / (f.B - f.A));
  // ⭐ confluência: um alvo (por atingir) do timeframe de baixo, a andar contra a tendência do de cima, cai na zona de entrada do de cima (61,8%–78,6%)
  function confluence(hiFib, loFibs) {
    if (!hiFib) return null;
    const zLo = Math.min(lv(hiFib.A, hiFib.B, ENTRY[0]), hiFib.deep), zHi = Math.max(lv(hiFib.A, hiFib.B, ENTRY[0]), hiFib.deep);
    let best = null;
    for (const f of loFibs || []) {
      if (f.dir === hiFib.dir) continue;   // o de baixo tem de estar a caminhar para a zona do de cima
      for (const t of f.targets) {
        if (t.hit) continue;
        const lo = Math.max(t.lo, zLo), hi = Math.min(t.hi, zHi);
        if (lo <= hi) { const p = (lo + hi) / 2, r = retrOf(hiFib, p) * 100; if (!best || Math.abs(r - 63.4) < Math.abs(best.retr - 63.4)) best = { tgt: t.name, f: t.f, lo: t.lo, hi: t.hi, p, retr: r, role: f.role, src: f }; }
      }
    }
    return best;
  }
  // nome do alvo com a origem: "Alvo 2 do Diário" (perna principal) ou "Alvo 2 do Diário (mov. recente)" (perna do movimento recente)
  const starName = (c, dl, tfName) => `${c.tgt} do ${tfName}${dl && (dl.fibsI || []).includes(c.src) && !(dl.fibs || []).includes(c.src) ? ' (mov. recente)' : ''}`;
  root.MSS_FIB = { starName, ENTRY, DEEP, INVAL, TGT, NEXT, lv, make, fibsOf, confluence, retrOf };
})(typeof window !== 'undefined' ? window : globalThis);

// Alertas do Scanner de Estrutura — a lógica (sem rede): recebe velas, definições e marcações; devolve as mensagens.
// Corre no vigia (Google Apps Script) e nos testes no computador. Usa o mesmo motor de estrutura da app (engine.js).
(function (root) {
  'use strict';
  const E = root.StructureEngine;
  const TF_MS = { '1Y': 365 * 864e5, '6M': 182 * 864e5, '3M': 91 * 864e5, '1M': 30 * 864e5, '1w': 7 * 864e5, '1d': 864e5, '4h': 144e5, '1h': 36e5, '15m': 9e5, '5m': 3e5 };
  const LBL = { '1Y': 'Anual', '6M': '6M', '3M': '3M', '1M': 'Mensal', '1w': 'Semanal', '1d': 'Diário', '4h': '4H', '1h': '1H', '15m': '15m', '5m': '5m' };
  const CTX_DEFAULT = { '1M': '6M', '1w': '1M', '1d': '1w', '4h': '1d', '1h': '4h', '15m': '1h', '5m': '15m' };
  const MAGG = { '3M': 3, '6M': 6, '1Y': 12 };
  // opções dos alertas (settings.alerts na app)
  const A_DEF = {
    on: true, tgToken: '', tgChat: '', relay: '',
    setupOn: true, setups: {}, minPull: 50, fOnlyFvg: false, fOnlyStrong: false, fOnlyVol: false, fOnlyCtx: false,
    fvgOn: true,
    kzOn: true, kzLondon: true, kzNy: true, kzAsia: true, kzDay: true, kzLon: true,
    weekOn: true, dayOn: false, weekSweep: true, weekClose: true,
    nearOn: true, nearTfs: ['1M', '1w', '1d', '4h'], nearPct: { '1Y': 8, '6M': 6, '3M': 5, '1M': 5, '1w': 3, '1d': 2, '4h': 1 }, nearInv: true, nearCont: false,
    smaOn: true, smaTfs: ['1w', '1d'], smaPre: 0, smaRearm: 5,
    tgtOn: true, tgtPct: 1, lineOn: true,
    fibOn: false, fibTfs: ['1w', '1d'], fib786: false, fibStar: false, kcAlOn: false, kcTfs: ['1M', '1w', '1d'],
    // para quem vale cada alerta: ativos normais (forA) e rácios A/B (forR)
    forA: { setup: true, fvg: true, kz: true, week: true, near: true, sma: true, tgt: true, line: true },
    forR: { setup: true, fvg: true, kz: false, week: true, near: true, sma: false, tgt: true, line: true },
  };
  const GRP_KEYS = { setup: ['setupOn'], fvg: ['fvgOn'], kz: ['kzOn'], week: ['weekOn', 'dayOn'], near: ['nearOn'], sma: ['smaOn'], tgt: ['tgtOn'], line: ['lineOn'] };
  const FB = root.MSS_FIB;
  // as escolhas de alertas que valem para este ativo (rácio ou não)
  function effA(A, sym) {
    const r = /^[^/\s]+\/[^/\s]+$/.test(String(sym || '')), g = Object.assign({}, r ? A_DEF.forR : A_DEF.forA, (r ? A.forR : A.forA) || {}), o = Object.assign({}, A);
    for (const k in GRP_KEYS) if (g[k] === false) GRP_KEYS[k].forEach((x) => { o[x] = false; });
    // escolhas por ativo (página Alertas → Por ativo): mandam sobre o resto
    const p = A.per && A.per[sym];
    if (p) {
      const M = { fvg: 'fvgOn', kz: 'kzOn', near: 'nearOn', sma: 'smaOn', tgt: 'tgtOn', line: 'lineOn', fibz: 'fibOn', kc: 'kcAlOn' };
      for (const k in M) if (p[k] != null) o[M[k]] = !!p[k];
      if (p.week === false) { o.weekOn = false; o.dayOn = false; }   // ligado: semana/dia conforme os Ajustes
      const sus = Object.keys(p).filter((k) => k.indexOf('su:') === 0);
      if (sus.length) { o.setups = Object.assign({}, o.setups); sus.forEach((k) => { o.setups[k.slice(3)] = !!p[k]; }); o.setupOn = sus.some((k) => p[k]); }
    }
    return o;
  }
  // este ativo tem algum alerta ligado? (senão o vigia nem o analisa)
  function anyOn(A, sym, S) {
    const e = effA(A, sym), su = e.setupOn && ((S && S.setups) || []).some((x) => x.on && (e.setups || {})[x.name] !== false);
    const ln = e.lineOn && (((S && S.lines) || {})[sym] || []).some((l) => l.alert);
    return !!(su || e.kzOn || e.weekOn || e.dayOn || e.nearOn || e.smaOn || e.fibOn || e.kcAlOn || ln);
  }
  const KZ_PROFILES = { ict: { asia: [20, 24], londres: [2, 5], ny: [7, 10], fecho: [10, 12] }, cripto: { asia: [20, 24], londres: [2, 5], ny: [8.5, 11] } };

  // ---------- hora de Nova Iorque (regras de mudança de hora dos EUA, sem depender do Intl) ----------
  function nyOffsetH(ms) {
    const y = new Date(ms).getUTCFullYear();
    const sun = (mo, nth) => { const wd = new Date(Date.UTC(y, mo, 1)).getUTCDay(); return 1 + (7 - wd) % 7 + 7 * (nth - 1); };
    const start = Date.UTC(y, 2, sun(2, 2), 7), end = Date.UTC(y, 10, sun(10, 1), 6);   // 2.º domingo de março 2h → 1.º domingo de novembro 2h
    return ms >= start && ms < end ? -4 : -5;
  }
  function nyParts(ms) { const d = new Date(ms + nyOffsetH(ms) * 36e5); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours() + d.getUTCMinutes() / 60, wd: (d.getUTCDay() + 6) % 7 }; }
  function dayKey(S, ms) { if (S.dayStart === 'utc') return Math.floor(ms / 864e5); const p = nyParts(ms); return Date.UTC(p.y, p.m - 1, p.d) / 864e5; }
  function weekKey(S, ms) { const dk = dayKey(S, ms); const wd = S.dayStart === 'utc' ? (new Date(dk * 864e5).getUTCDay() + 6) % 7 : nyParts(ms).wd; return dk - wd; }
  function sessionsCfg(S) {
    const m = Object.assign({}, KZ_PROFILES[S.kzProfile] || KZ_PROFILES.cripto);
    String(S.sessions || '').split(/[,;]+/).forEach((p) => { const r = /(\w+)\s*:\s*([\d.]+)\s*-\s*([\d.]+)/.exec(p.trim()); if (r) m[r[1].toLowerCase()] = [+r[2], +r[3]]; });
    return m;
  }
  const inSess = (h, s) => (s[0] <= s[1] ? h >= s[0] && h < s[1] : h >= s[0] || h < s[1]);

  // ---------- números como na app (pt-PT) ----------
  function fmt(p) {
    if (p == null || !isFinite(p)) return '—';
    const d = p >= 1000 ? 0 : p >= 100 ? 1 : p >= 1 ? 2 : p >= 0.01 ? 4 : 6;
    const s = Math.abs(p).toFixed(d).split('.');
    const int = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (p < 0 ? '-' : '') + int + (s[1] ? ',' + s[1] : '');
  }
  const pct = (x) => (x == null || !isFinite(x) ? '—' : x.toFixed(1).replace('.', ',') + '%');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ---------- marcações (o mesmo formato que a app grava na conta) ----------
  function deserEd(r) {
    const L = (x) => ({ ign: new Set((x && x.ign) || []), add: new Map((x && x.add) || []), noBreak: new Set((x && x.noBreak) || []), yesBreak: new Set((x && x.yesBreak) || []), start: (x && x.start) || null, modes: (x && x.modes) || [], noLvl: new Set((x && x.noLvl) || []), blank: !!(x && x.blank), range: (x && x.range) || null, hideAuto: (x && x.hideAuto) || {} });
    return { fvg: new Set(r.fvg || []), int: L(r.int), ext: L(r.ext) };
  }
  // a hora mais antiga referida pelas marcações (para saber se é preciso ir buscar mais história)
  function earliestEdit(ed) {
    if (!ed) return Infinity;
    let m = Infinity; const see = (t) => { if (typeof t === 'number' && t < m) m = t; };
    for (const L of [ed.int, ed.ext]) {
      L.ign.forEach(see); L.add.forEach((v, k) => see(k)); L.noBreak.forEach(see); L.yesBreak.forEach(see); L.noLvl.forEach(see);
      if (L.start) see(L.start.t); (L.modes || []).forEach((x) => see(x && x.t));
    }
    ed.fvg.forEach(see);
    return m;
  }
  function failFor(S, id) {
    const m = {}; String(S.failByTf || '').split(/[,;\s]+/).forEach((p) => { const kv = p.split(':'); if (kv[0] && kv[1] != null && kv[1] !== '' && isFinite(+kv[1])) m[kv[0].trim()] = +kv[1]; });
    return m[id] != null ? m[id] : +S.failBars;
  }
  // a mesma conta da app (computeTf): tendência principal e movimento recente, só com velas fechadas
  function computeTf(cs, id, S, ed, now) {
    cs.forEach((c) => (c.tt = Math.floor(c.t / 1000)));
    const closed = cs.filter((c) => c.ct < now);
    const price = cs[cs.length - 1].c;
    const base = { confirm: +S.confirm, lockBars: +S.lockBars, volMult: +S.volMult, dispAtr: +S.dispAtr, contBars: +S.contBars, fvgMinAtr: +S.fvgMinAtr, contAtr: +S.contAtr, closeMarginAtr: +S.closeMarginAtr, acceptBars: +S.acceptBars, failBars: failFor(S, id), legRatio: +S.legRatio, floorAtr: +S.floorAtr };
    const layer = (fn, atrMult, reqDisp, ov) => {
      const res = fn(closed, Object.assign({}, base, { minRetraceAtr: +atrMult, requireDisp: !!reqDisp, ov: ov || null }));
      return { res, snap: E.snapshot(res, price, closed.length - 1, closed.length ? closed[closed.length - 1].c : price) };
    };
    const d = { candles: cs, closed, price, ext: layer(E.analyze, S.extAtr, S.dispExt, ed && Object.assign({ ignFvg: ed.fvg }, ed.ext)), int: layer(E.analyzeRecent, S.intAtr, S.dispInt, ed && Object.assign({ ignFvg: ed.fvg }, ed.int)) };
    if (FB) { try { d.fibs = FB.fibsOf(d.ext.res, closed, price); d.fibsI = FB.fibsOf(d.int.res, closed, price); } catch (e) { d.fibs = []; d.fibsI = []; } }
    return d;
  }
  function aggregateMonths(cs, k) {
    const out = []; let key = null, cur = null;
    for (const c of cs) {
      const d = new Date(c.t), kk = d.getUTCFullYear() * 12 + Math.floor(d.getUTCMonth() / k) * k;
      if (kk !== key) { key = kk; cur = { t: c.t, ct: c.ct, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }; out.push(cur); }
      else { cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l); cur.c = c.c; cur.v += c.v; cur.ct = c.ct; }
    }
    if (out.length) { const last = out[out.length - 1], d = new Date(last.t), end = Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / k) * k + k, 1) - 1; last.ct = Math.max(last.ct, end); }
    return out;
  }
  function aggregateSession(cs, k) {   // 1H → 4H nas ações, a contar da abertura de cada sessão
    const out = []; let day = null, n = 0, cur = null;
    for (const c of cs) {
      const d = new Date(c.t).toISOString().slice(0, 10);
      if (d !== day) { day = d; n = 0; }
      if (n % k === 0) { cur = { t: c.t, ct: c.ct, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }; out.push(cur); }
      else { cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l); cur.c = c.c; cur.v += c.v; cur.ct = c.ct; }
      n++;
    }
    return out;
  }
  // ---------- rácios (A/B) ----------
  const isRatio = (s) => /^[^/\s]+\/[^/\s]+$/.test(String(s || ''));
  const R_BASE = { '1Y': '1M', '6M': '1M', '3M': '1M', '1M': '1M', '1w': '1w', '1d': '1d', '4h': '1h', '1h': '1h', '15m': '15m', '5m': '5m' };
  const R_KEY = {
    '1M': (t) => { const d = new Date(t + 6 * 36e5); return d.getUTCFullYear() * 12 + d.getUTCMonth(); },
    '1w': (t) => Math.floor((t - 2.5 * 864e5) / (7 * 864e5)),
    '1d': (t) => Math.floor((t + 6 * 36e5) / 864e5),
    '1h': (t) => Math.floor(t / 36e5), '15m': (t) => Math.floor(t / 9e5), '5m': (t) => Math.floor(t / 3e5),
  };
  function ratioJoin(a, b, key, timeFromA) {
    const m = new Map(); for (const y of b) m.set(key(y.t), y);
    const out = []; let lastK = null;
    for (const x of a) {
      const k = key(x.t), y = m.get(k);
      if (!y || !(y.o > 0 && y.h > 0 && y.l > 0 && y.c > 0) || !(x.o > 0 && x.c > 0)) continue;
      const o = x.o / y.o, c = x.c / y.c;
      const r = { t: timeFromA ? x.t : y.t, ct: Math.max(x.ct, y.ct), o, c, h: Math.max(o, c, x.h / y.h), l: Math.min(o, c, x.l / y.l), v: 0 };
      if (k === lastK) out[out.length - 1] = r; else out.push(r);
      lastK = k;
    }
    return out.sort((p, q) => p.t - q.t);
  }
  function agg4h(cs) {
    const g = new Map(), k = 4 * 36e5;
    for (const c of cs) { const key = Math.floor(c.t / k) * k, x = g.get(key); if (!x) g.set(key, { t: key, ct: key + k - 1, o: c.o, h: c.h, l: c.l, c: c.c, v: 0 }); else { x.h = Math.max(x.h, c.h); x.l = Math.min(x.l, c.l); x.c = c.c; } }
    return [...g.values()];
  }
  // velas do rácio por timeframe, a partir das velas base (1M, 1w, 1d, 1h, 15m, 5m) de cada perna
  function ratioRaw(ga, gb, tfs, timeFromA) {
    if (ga._err || gb._err) return { _err: ga._err || gb._err };
    const r = {}, out = {};
    for (const id of tfs) { const b = R_BASE[id]; if (!b || r[b] || !ga[b] || !gb[b]) continue; r[b] = ratioJoin(ga[b], gb[b], R_KEY[b], timeFromA); }
    for (const b in r) out[b] = r[b];
    for (const id of tfs) { const cs = r[R_BASE[id]]; if (!cs) continue; out[id] = id === '4h' ? agg4h(cs) : MAGG[id] ? aggregateMonths(cs, MAGG[id]) : cs; }
    return out;
  }
  const baseTfs = (tfs) => [...new Set(tfs.map((id) => R_BASE[id]).filter(Boolean))];
  const ctxOf = (su) => su.ctx || CTX_DEFAULT[su.zone] || null;
  // timeframes de que os alertas precisam
  function neededTfs(S, A) {
    const s = new Set();
    if (A.setupOn || A.fvgOn) (S.setups || []).filter((x) => x.on && A.setups[x.name] !== false).forEach((x) => { s.add(x.zone); s.add(x.trig); if (ctxOf(x)) s.add(ctxOf(x)); if (FB && FB.NEXT[x.zone]) s.add(FB.NEXT[x.zone]); });
    if (A.lineOn) Object.values(S.lines || {}).forEach((ls) => (ls || []).forEach((l) => { if (l.alert) s.add(l.tf); }));
    if (A.kzOn) { s.add('5m'); s.add('1h'); }
    if (A.weekOn || A.dayOn) s.add('1h');
    if (A.nearOn) (A.nearTfs || []).forEach((id) => s.add(id));
    if (A.smaOn) (A.smaTfs || []).forEach((id) => s.add(id));
    const anyP = (k) => Object.values(A.per || {}).some((p) => p && p[k] === true);
    if (A.fibOn || anyP('fibz')) (A.fibTfs || A_DEF.fibTfs).forEach((id) => s.add(id));
    if (A.kcAlOn || anyP('kc')) (A.kcTfs || A_DEF.kcTfs).forEach((id) => s.add(id));
    return [...s];
  }

  // ---------- indicadores para a linha de confluência ----------
  function smaLast(v, n) { if (v.length < n) return null; let s = 0; for (let i = v.length - n; i < v.length; i++) s += v[i]; return s / n; }
  function emaLast(v, n) { if (v.length < n) return null; let e = 0; for (let i = 0; i < n; i++) e += v[i]; e /= n; const k = 2 / (n + 1); for (let i = n; i < v.length; i++) e = v[i] * k + e * (1 - k); return e; }
  function atrLast(cs, n) { if (cs.length <= n) return null; let a = 0; for (let i = 0; i < cs.length; i++) { const c = cs[i], tr = i ? Math.max(c.h - c.l, Math.abs(c.h - cs[i - 1].c), Math.abs(c.l - cs[i - 1].c)) : c.h - c.l; if (i < n) { a += tr; if (i === n - 1) a /= n; } else a = (a * (n - 1) + tr) / n; } return a; }
  function confluence(dm, ids, price) {
    const out = [];
    for (const id of ids) {
      const d = dm[id]; if (!d || d.candles.length < 30) continue;
      const cl = d.candles.map((c) => c.c), atr = atrLast(d.candles, 14);
      if (atr) for (const n of [200, 100, 50]) { const m = smaLast(cl, n); if (m != null && Math.abs(price - m) <= 0.5 * atr) { out.push(`SMA ${n} (${LBL[id]}) a ${pct(Math.abs(price - m) / price * 100)}`); break; } }
      const mid = emaLast(cl, 20), a10 = atrLast(d.candles, 10);
      if (mid != null && a10) { if (price > mid + 3 * a10) out.push(`acima do Keltner +3ATR (${LBL[id]})`); else if (price < mid - 3 * a10) out.push(`abaixo do Keltner −3ATR (${LBL[id]})`); }
    }
    return out;
  }

  // ---------- liquidez: dia e semana anteriores, sessões Ásia e Londres (velas de 1H) ----------
  function levels(cs, S, now) {
    const out = {};
    const group = (keyFn, id, label) => {
      const cur = keyFn(now); let k = null; const g = [];
      for (let i = cs.length - 1; i >= 0; i--) { const kk = keyFn(cs[i].t); if (kk >= cur) continue; if (k == null) k = kk; if (kk !== k) break; g.push(cs[i]); }
      if (g.length) out[id] = { id, label, top: Math.max(...g.map((c) => c.h)), bot: Math.min(...g.map((c) => c.l)), t1: g[0].ct + 1 };
    };
    group((ms) => dayKey(S, ms), 'day', 'dia anterior');
    group((ms) => weekKey(S, ms), 'week', 'semana anterior');
    const sessRange = (id, label, s) => {
      let g = [], kk = null;
      for (let i = cs.length - 1; i >= 0; i--) {
        const c = cs[i], inS = inSess(nyParts(c.t).h, s);
        if (!g.length) { if (inS && c.ct < now) { g.push(c); kk = c.t; } else continue; }
        else if (inS && kk - c.t <= 36e5 * 12) { g.push(c); kk = c.t; } else break;
      }
      if (g.length && cs.some((c) => c.t > g[0].t && !inSess(nyParts(c.t).h, s))) out[id] = { id, label, top: Math.max(...g.map((c) => c.h)), bot: Math.min(...g.map((c) => c.l)), t1: g[0].ct + 1 };
    };
    const sc = sessionsCfg(S);
    sessRange('asia', 'Ásia', sc.asia);
    sessRange('london', 'Londres', sc.londres);
    return out;
  }

  // ---------- 1) setups: zona com correção ≥ X% e quebra no timeframe de gatilho, no fecho da vela ----------
  function setupAlerts(sym, dm, S, A, st, now, out) {
    for (const su of (S.setups || []).filter((x) => x.on && A.setups[x.name] !== false)) {
      const dz = dm[su.zone], dt = dm[su.trig]; if (!dz || !dt) continue;
      const z = dz.ext.snap; if (!z.trend) continue;
      const dir = z.trend, t = dt.int.snap, lb = t.lastBreak;
      if (!lb || lb.dir !== dir || t.trend !== dir) continue;
      const cl = dt.closed, bc = cl[lb.i], cc = cl[Math.min(cl.length - 1, lb.conf != null ? lb.conf : lb.i)];
      if (!bc || !cc) continue;
      const key = `s|${sym}|${su.name}|${bc.t}|${dir}`;
      if (st.seen[key]) continue;
      st.seen[key] = now;
      // a zona tem de estar em correção ≥ mínimo; quebras antigas (vigia desligado, 1.ª volta) ficam vistas sem aviso
      if (!(z.pullback >= +A.minPull) || z.pullback > 91.8) continue;   // acima de 91,8% está perto da invalidação: não é setup
      if (cc.ct < now - (TF_MS[su.trig] + 40 * 6e4) || st.silent) continue;
      const f = dt.int.res.fvgs.find((x) => x.dir === dir && x.mid >= lb.i - 1 && x.mid <= Math.max(lb.i, lb.conf || lb.i) + 1);
      const cid = ctxOf(su), cx = cid && dm[cid] && dm[cid].ext.snap;
      const ctxFav = !!(cx && cx.trend === dir);
      if (A.fOnlyFvg && lb.fvg !== 'sim') continue;
      if (A.fOnlyStrong && lb.candle !== 'forte') continue;
      if (A.fOnlyVol && lb.volume !== 'sim') continue;
      if (A.fOnlyCtx && !ctxFav) continue;
      const up = dir === 1, side = up ? 'LONG' : 'SHORT';
      const fvgTxt = lb.fvg === 'sim' && f ? `FVG ✔ ${fmt(f.bot)} – ${fmt(f.top)}` : lb.fvg === 'pendente' ? 'FVG a formar' : 'sem FVG';
      const vela = lb.candle === 'forte' ? 'vela forte' : lb.candle === 'fraca' ? 'vela fraca' : 'vela normal';
      const vol = lb.volRatio ? `vol ${lb.volRatio.toFixed(1).replace('.', ',')}×${lb.volume === 'sim' ? ' (alto)' : ''}` : '';
      const fecho = lb.closeAtr == null ? '' : lb.closeTight ? 'fecho colado ⚠' : `fecho ${lb.closeAtr.toFixed(1).replace('.', ',')} ATR além`;
      const ctxTxt = !(cx && cx.trend) ? 'sem dados' : ctxFav ? (cx.pullback > 78.6 ? `a favor, mas fundo (${pct(cx.pullback)}) — perto de virar` : 'a favor') : `contra (${pct(cx.pullback)})`;
      // 💧 a quebra veio depois de um sweep do lado oposto (até 20 velas antes), como na app
      const swept = (dt.int.res.sweeps || []).some((sw) => !sw.invalid && sw.dir === -lb.dir && sw.i <= lb.i && lb.i - sw.i <= 20);
      const conf = confluence(dm, [...new Set([su.zone, cid].filter(Boolean))], dt.price);
      const prot = t.protected;
      const lines = [
        `${up ? '🟢' : '🔴'} <b>${side} · ${esc(su.name)} · ${esc(sym)}</b>`,
        `Zona ${LBL[su.zone]}: ${up ? 'Zona de Long' : 'Zona de Short'} · correção ${pct(z.pullback)}`,
        `Gatilho ${LBL[su.trig]}: ${lb.type} ${up ? 'para cima' : 'para baixo'} em ${fmt(lb.level)} (fecho ${fmt(bc.c)})`,
        `Extra: ${[swept ? '💧 depois de sweep' : '', fvgTxt, vela, vol, fecho].filter(Boolean).join(' · ')}`,
        `Contexto ${cid ? '(' + LBL[cid] + ')' : ''}: ${ctxTxt}`,
      ];
      if (conf.length) lines.push(`Confluência: ${conf.join(' · ')}`);
      // Fibonacci da zona: entrada ótima / profunda, ⭐ confluência com o timeframe de baixo, alvos
      const zf = dz.fibs && dz.fibs[0];
      if (zf) {
        const zp = z.pullback, ent = zp >= 61.8 && zp <= 65 ? ' · ✔ entrada ótima (61,8–65%)' : zp > 78.6 ? ' · profunda (> 78,6%)' : '';
        if (ent) lines[1] += ent;
        const lo = FB.NEXT[su.zone], dl = lo && dm[lo], star = dl ? FB.confluence(zf, [...(dl.fibs || []), ...(dl.fibsI || [])]) : null;
        if (star) lines.push(`⭐ ${FB.starName(star, dl, LBL[lo])} (${fmt(star.lo)} – ${fmt(star.hi)}) cai na zona do ${LBL[su.zone]} (retração ${pct(star.retr)})`);
        lines.push(`Alvos (${LBL[su.zone]}): topo/fundo da perna ${fmt(zf.B)} · ${zf.targets.map((x) => `${x.name.replace('Alvo ', 'A')} ${fmt(x.lo)}–${fmt(x.hi)}`).join(' · ')}`);
        if (A.tgtOn) {
          st.tgw = (st.tgw || []).filter((x) => !(x.sym === sym && x.name === su.name));
          const tg = [{ name: up ? 'topo da perna' : 'fundo da perna', near: zf.B }].concat(zf.targets.filter((x) => !x.hit).map((x) => ({ name: x.name, near: x.near, lo: x.lo, hi: x.hi })));
          tg.forEach((x) => st.tgw.push({ sym, name: su.name, tf: su.zone, dir, origin: zf.A, tname: x.name, near: x.near, lo: x.lo, hi: x.hi, at: now }));
        }
      }
      if (prot != null) lines.push(`Invalida ${up ? 'abaixo' : 'acima'} de ${fmt(prot)}`);
      if (A.fvgOn) lines.push('<i>A seguir: aviso quando o preço tocar num FVG para lá dos 50% da pernada.</i>');
      out.push({ kind: 'setup', sym, tf: su.zone, text: lines.join('\n') });
      // segue o pullback desta quebra (alerta 4)
      const s0 = dt.int.res.state;
      if (s0 && s0.prot) {
        st.trk = st.trk.filter((x) => !(x.sym === sym && x.name === su.name));
        st.trk.push({ sym, name: su.name, tf: su.trig, dir, origin: s0.prot.p, originT: cl[s0.prot.i] ? cl[s0.prot.i].t : bc.t, since: cc.ct, at: now, done: [] });
      }
    }
  }

  // ---------- 4) depois do alerta de setup: o preço toca num FVG do gatilho para lá dos 50% da pernada ----------
  function trackerAlerts(sym, dm, A, st, now, out) {
    st.trk = st.trk.filter((tr) => {
      if (tr.sym !== sym) return true;
      const d = dm[tr.tf]; if (!d) return true;
      const up = tr.dir === 1, cs = d.candles, title = `${up ? 'LONG' : 'SHORT'} · ${esc(tr.name)} · ${esc(sym)}`;
      const after = cs.filter((c) => c.t > tr.since);
      const inv = after.some((c) => (up ? c.l < tr.origin : c.h > tr.origin));
      const sn = d.int.snap;
      if (inv || (sn.trend && sn.trend !== tr.dir)) {
        if (A.fvgOn && !st.silent) out.push({ kind: 'invalid', sym, tf: tr.tf, text: `⚪ <b>Invalidado · ${title}</b>\n${inv ? `O preço passou a origem da pernada (${fmt(tr.origin)}).` : `O ${LBL[tr.tf]} voltou a quebrar ${up ? 'para baixo' : 'para cima'}.`} Deixo de seguir este setup.` });
        return false;
      }
      if (now - tr.at > 14 * 864e5) return false;
      if (!A.fvgOn) return true;
      const leg = cs.filter((c) => c.t >= tr.originT);
      if (!leg.length) return true;
      const ext = up ? Math.max(...leg.map((c) => c.h)) : Math.min(...leg.map((c) => c.l));
      const size = Math.abs(ext - tr.origin); if (!size) return true;
      const l50 = ext > 0 && tr.origin > 0 ? Math.sqrt(ext * tr.origin) : up ? ext - size / 2 : ext + size / 2;   // 50% da pernada em escala log (média geométrica)
      const cl = d.closed;
      const fv = d.int.res.fvgs.filter((f) => f.dir === tr.dir && cl[f.mid] && cl[f.mid].t >= tr.originT).filter((f) => {
        for (let j = f.created + 1; j < cl.length; j++) if (up ? cl[j].c < f.bot : cl[j].c > f.top) return false;   // ainda não atravessado por um fecho
        return up ? f.bot < l50 : f.top > l50;
      });
      for (const f of fv) {
        const fk = String(cl[f.mid].t); if (tr.done.indexOf(fk) >= 0) continue;
        // conta o toque na parte do FVG que já está para lá dos 50% (um FVG que começa antes dos 50% só conta a partir deles)
        const edge = up ? Math.min(f.top, l50) : Math.max(f.bot, l50);
        let j = -1; for (let k = f.created + 1; k < cs.length; k++) if (up ? cs[k].l <= edge : cs[k].h >= edge) { j = k; break; }
        if (j < 0) continue;
        tr.done.push(fk);
        if (cs[j].t <= tr.since || cs[j].t < now - (TF_MS[tr.tf] + 40 * 6e4) || st.silent) continue;   // tocado antes da quebra ou aviso atrasado
        const touch = edge;
        const corr = Math.abs(ext - touch) / size * 100;
        out.push({ kind: 'fvg', sym, tf: tr.tf, text: [
          `🎯 <b>FVG no pullback · ${title}</b>`,
          `O preço tocou o FVG ${LBL[tr.tf]} ${fmt(f.bot)} – ${fmt(f.top)}`,
          `Correção da pernada: ${pct(corr)} (origem ${fmt(tr.origin)} → ${up ? 'topo' : 'fundo'} ${fmt(ext)})`,
          `Invalida ${up ? 'abaixo' : 'acima'} de ${fmt(tr.origin)}`,
        ].join('\n') });
      }
      return true;
    });
  }

  // ---------- 2) killzones: liquidez apanhada dentro das horas de Londres / NY (velas de 5m) ----------
  function kzAlerts(sym, c5, c1h, S, A, st, now, out) {
    if (!A.kzOn || !c5 || !c1h) return;
    const sc = sessionsCfg(S), lv = levels(c1h, S, now);
    const kzs = [['Londres', sc.londres, A.kzLondon], ['NY', sc.ny, A.kzNy]].filter((k) => k[2] && k[1]);
    for (const kz of kzs) {
      const cand = [A.kzAsia && lv.asia, A.kzDay && lv.day, kz[0] === 'NY' && A.kzLon && lv.london].filter(Boolean);
      for (const r of cand) for (const side of [1, -1]) {
        const p = side === 1 ? r.top : r.bot;
        let j = -1; for (let k = 0; k < c5.length; k++) { const c = c5[k]; if (c.t < r.t1 || c.ct >= now) continue; if (side === 1 ? c.h > p : c.l < p) { j = k; break; } }
        if (j < 0) continue;
        const c = c5[j];
        const np = nyParts(c.t);
        if (!inSess(np.h, kz[1])) continue;   // apanhada fora desta killzone
        if (np.wd >= 5) continue;             // sábado e domingo: não há sessões de Londres / NY
        const key = `k|${sym}|${r.id}|${r.t1}|${side}`;
        if (st.seen[key]) continue;
        st.seen[key] = now;
        if (c.ct < now - 40 * 6e4 || st.silent) continue;
        const nm = `${side === 1 ? 'topo' : 'fundo'} ${r.id === 'day' ? 'do dia anterior' : r.id === 'asia' ? 'da Ásia' : 'de Londres'}`;
        const back = side === 1 ? c.c <= p : c.c >= p;
        out.push({ kind: 'kz', sym, text: [
          `⏱ <b>Killzone ${kz[0]} · ${esc(sym)}</b>`,
          back ? `💧 Sweep do ${nm} (${fmt(p)}): a vela de 5m fechou de volta ${side === 1 ? 'abaixo' : 'acima'} (${fmt(c.c)})`
            : `${side === 1 ? '▲' : '▼'} ${nm[0].toUpperCase() + nm.slice(1)} (${fmt(p)}) apanhado: a vela de 5m fechou ${side === 1 ? 'acima' : 'abaixo'} (${fmt(c.c)})`,
        ].join('\n') });
      }
    }
  }

  // ---------- 3) liquidez semanal: máximo / mínimo da semana anterior, decidido pelo fecho de 1H ----------
  function weekAlerts(sym, c1h, c5, S, A, st, now, out) {
    if (!c1h) return;
    const lv = levels(c1h, S, now), sc = sessionsCfg(S);
    // dia anterior apanhado dentro de uma killzone ligada: já foi avisado no ponto 3 (vela de 5m) — aqui não se repete
    const kzOnly = (p, side, t1) => {
      if (!A.kzOn || !A.kzDay || !c5) return false;
      const kzs = [A.kzLondon && sc.londres, A.kzNy && sc.ny].filter(Boolean);
      for (const c of c5) { if (c.t < t1 || c.ct >= now) continue; if (side === 1 ? c.h > p : c.l < p) return kzs.some((z) => inSess(nyParts(c.t).h, z)); }
      return false;
    };
    for (const [id, on] of [['week', A.weekOn], ['day', A.dayOn]]) {
      const r = lv[id]; if (!on || !r) continue;
      for (const side of [1, -1]) {
        const p = side === 1 ? r.top : r.bot;
        let j = -1; for (let k = 0; k < c1h.length; k++) { const c = c1h[k]; if (c.t < r.t1 || c.ct >= now) continue; if (side === 1 ? c.h > p : c.l < p) { j = k; break; } }
        if (j < 0) continue;
        const c = c1h[j], key = `${id === 'week' ? 'w' : 'd'}|${sym}|${r.t1}|${side}`;
        if (st.seen[key]) continue;
        st.seen[key] = now;
        if (c.ct < now - 3 * 36e5 || st.silent) continue;
        if (id === 'day' && kzOnly(p, side, r.t1)) continue;
        const back = side === 1 ? c.c <= p : c.c >= p;
        if (back ? !A.weekSweep : !A.weekClose) continue;
        const nm = (side === 1 ? 'Máximo' : 'Mínimo') + (id === 'week' ? ' da semana anterior' : ' do dia anterior');
        out.push({ kind: id, sym, text: [
          `${back ? '💧' : side === 1 ? '▲' : '▼'} <b>Liquidez ${id === 'week' ? 'semanal' : 'diária'} · ${esc(sym)}</b>`,
          back ? `${nm} (${fmt(p)}) varrido — <b>sweep</b>: a vela de 1H fechou de volta ${side === 1 ? 'abaixo' : 'acima'} (${fmt(c.c)})`
            : `${nm} (${fmt(p)}) apanhado <b>com vela</b>: a vela de 1H fechou ${side === 1 ? 'acima' : 'abaixo'} (${fmt(c.c)})`,
        ].join('\n') });
      }
    }
  }

  // ---------- 5) perto da quebra da tendência principal (inversão = limite / continuação = topo-fundo da perna) ----------
  function nearAlerts(sym, dm, A, st, now, out) {
    if (!A.nearOn) return;
    const P = Object.assign({}, A_DEF.nearPct, A.nearPct || {});
    for (const id of A.nearTfs || []) {
      const d = dm[id]; if (!d) continue;
      const s = d.ext.snap; if (!s.trend) continue;
      const up = s.trend === 1, price = d.price, thr = price * (P[id] != null ? +P[id] : 0.5) / 100;
      const kinds = [];
      if (A.nearInv && s.protected != null) kinds.push(['inv', s.protected]);
      if (A.nearCont && s.extreme != null) kinds.push(['cont', s.extreme]);
      for (const [kind, lvl] of kinds) {
        const key = `n|${sym}|${id}|${kind}|${lvl}`;
        // do lado certo do nível: inversão — acima do limite numa subida; continuação — abaixo do topo numa subida
        const gap = kind === 'inv' ? (up ? price - lvl : lvl - price) : (up ? lvl - price : price - lvl);
        if (gap < 0) continue;                                   // já passou (a quebra é avisada pela própria estrutura)
        if (st.seen[key] && gap > 2 * thr) { delete st.seen[key]; continue; }   // afastou-se: volta a poder avisar
        if (gap > thr || st.seen[key]) continue;
        st.seen[key] = now;
        if (st.silent) continue;
        const inv = kind === 'inv';
        out.push({ kind: 'near', sym, text: [
          `${inv ? '⚠️' : '↗'} <b>Perto da ${inv ? 'inversão' : 'continuação'} · ${LBL[id]} · ${esc(sym)}</b>`,
          `Tendência principal ${up ? 'em subida' : 'em descida'}: o preço (${fmt(price)}) está a ${pct(gap / price * 100)} ${inv ? 'do limite' : (up ? 'do topo da perna' : 'do fundo da perna')} ${fmt(lvl)}.`,
          inv ? `Um fecho ${up ? 'abaixo' : 'acima'} = CHoCH: a tendência do ${LBL[id]} vira para ${up ? 'baixo' : 'cima'}.` : `Um fecho ${up ? 'acima' : 'abaixo'} = BOS: a tendência do ${LBL[id]} continua.`,
        ].join('\n') });
      }
    }
  }

  // ---------- 6: o preço chega à SMA 200 (a descer: possível compra; a subir: teste à média) ----------
  // fica "armado" quando o preço está a mais de smaRearm% da média; avisa uma vez quando um pavio chega à média (ou a smaPre% dela)
  function smaAlerts(sym, raw, dm, A, st, now, out) {
    if (!A.smaOn) return;
    st.sma = st.sma || {};
    const pre = Math.max(0, +A.smaPre || 0) / 100, rearm = Math.max(0.5, +A.smaRearm || 5) / 100;
    for (const id of A.smaTfs || []) {
      const cs = raw[id]; if (!cs || cs.length < 200) continue;
      let sum = 0; for (let i = cs.length - 200; i < cs.length; i++) sum += cs[i].c;
      const sma = sum / 200, price = cs[cs.length - 1].c, dist = (price - sma) / sma, key = sym + '|' + id;
      let rec = st.sma[key];
      if (!rec) { st.sma[key] = { side: dist >= 0 ? 1 : -1, armed: Math.abs(dist) > rearm, at: now }; continue; }
      if (!rec.armed) { if (Math.abs(dist) > rearm) { rec.side = dist >= 0 ? 1 : -1; rec.armed = true; rec.at = now; } continue; }
      // velas mais finas desde que ficou armado: um pavio que chegou à média (ou à distância de aviso) conta
      const fine = raw['5m'] || raw['1h'] || cs, lvl = rec.side === 1 ? sma * (1 + pre) : sma * (1 - pre);
      const hit = fine.some((c) => c.ct > rec.at && (rec.side === 1 ? c.l <= lvl : c.h >= lvl)) || (rec.side === 1 ? price <= lvl : price >= lvl);
      if (!hit) { if ((dist >= 0 ? 1 : -1) !== rec.side) { rec.side = dist >= 0 ? 1 : -1; rec.at = now; } continue; }   // mudou de lado sem pavio na média (salto): passa a contar do lado novo
      rec.armed = false; rec.at = now;
      if (st.silent) continue;
      const down = rec.side === 1, d = dm[id], sn = d && d.ext && d.ext.snap;
      const tr = sn && sn.trend ? `Tendência principal do ${LBL[id]}: ${sn.trend === 1 ? '▲ subida' : '▼ descida'}${sn.pullback != null ? ` · correção ${pct(sn.pullback)}` : ''}` : '';
      out.push({ kind: 'sma', sym, text: [
        `${down ? '💰' : '🧱'} <b>SMA 200 · ${LBL[id]} · ${esc(sym)}</b>`,
        down ? `O preço desceu até à SMA 200 (${fmt(sma)}) — está a ${pct(Math.abs(dist) * 100)} dela. Possível zona de compra.` : `O preço subiu até à SMA 200 (${fmt(sma)}) — está a ${pct(Math.abs(dist) * 100)} dela. Teste à média: resistência ou recuperação.`,
        tr,
      ].filter(Boolean).join('\n') });
    }
  }

  // ---------- um ativo: velas em bruto → mensagens ----------
  // raw: { tfId: [{t, ct, o, h, l, c, v}] } (já com 3M/6M/1Y agrupados); edits: { 'SYM|tf': ed }
  // ---------- 9: o preço entra na zona de entrada (Fibonacci 0,618–0,65; opcional 0,786) da perna atual ----------
  function fibAlerts(sym, dm, A, st, now, out) {
    if (!A.fibOn || !FB) return;
    st.fibz = st.fibz || {};
    for (const id of A.fibTfs || []) {
      const d = dm[id], f = d && d.fibs && d.fibs[0]; if (!f || !d.price) continue;
      const up = f.dir === 1, p = d.price, leg = `${sym}|${id}|${f.A.toPrecision(6)}|${f.B.toPrecision(6)}`;
      if (up ? p < f.A : p > f.A) continue;   // já passou a origem: perna invalidada
      const lv = [['e', up ? f.entry.hi : f.entry.lo, 'entrada ótima (0,618–0,65)', `${fmt(f.entry.lo)} – ${fmt(f.entry.hi)}`]];
      if (A.fib786) lv.push(['d', f.deep, 'zona profunda (0,786)', fmt(f.deep)]);
      for (const [k, lvl, nmz, val] of lv) {
        const key = leg + '|' + k; if (st.fibz[key]) continue;
        if (!(up ? p <= lvl : p >= lvl)) continue;
        const r = FB.retrOf(f, p) * 100, lo = FB.NEXT[id], dl = lo && dm[lo], star = dl ? FB.confluence(f, [...(dl.fibs || []), ...(dl.fibsI || [])]) : null;
        if (A.fibStar && !star) continue;   // "só com confluência ⭐": sem alvo do TF de baixo na zona, não avisa (e pode avisar mais tarde se a ⭐ aparecer)
        st.fibz[key] = now;
        if (st.silent) continue;
        out.push({ kind: 'fibz', sym, text: [
          `${up ? '🟢' : '🔴'} <b>Zona de entrada · ${LBL[id]} · ${esc(sym)}</b>`,
          `O preço (${fmt(p)}) entrou na ${nmz} da ${up ? 'subida' : 'descida'} (1 = ${fmt(f.A)} → 0 = ${fmt(f.B)}): ${val} · retração ${pct(r)}. Possível ${up ? 'compra' : 'venda'} — espera a quebra no timeframe de baixo.`,
          star ? `⭐ ${FB.starName(star, dl, LBL[lo])} (${fmt(star.lo)} – ${fmt(star.hi)}) cai nesta zona` : '',
          `Invalida ${up ? 'abaixo' : 'acima'} de ${fmt(f.A)}`,
        ].filter(Boolean).join('\n') });
      }
    }
    for (const k of Object.keys(st.fibz)) if (now - st.fibz[k] > 400 * 864e5) delete st.fibz[k];
  }
  // ---------- 10: uma vela fecha fora do Keltner (EMA 20 ± 3 ATR 10) — só Diário, Semanal e Mensal ----------
  function kcAlerts(sym, raw, A, st, now, out) {
    if (!A.kcAlOn) return;
    st.kc = st.kc || {};
    for (const id of (A.kcTfs || []).filter((x) => ['1d', '1w', '1M'].includes(x))) {
      const cs = (raw[id] || []).filter((c) => c.ct < now); if (cs.length < 40) continue;
      const key = sym + '|' + id, rec = st.kc[key] || (st.kc[key] = { armed: true, done: cs[cs.length - 2].t });
      // vê cada vela fechada desde a última vista (no máximo 5)
      const from = Math.max(30, cs.findIndex((c) => c.t > rec.done), cs.length - 5);
      if (from < 0 || cs[cs.length - 1].t <= rec.done) continue;
      for (let n = from; n < cs.length; n++) {
        const sub = cs.slice(0, n + 1), cl = sub.map((c) => c.c), mid = emaLast(cl, 20), a = atrLast(sub, 10), lc = cs[n];
        rec.done = lc.t; if (mid == null || !a) continue;
        const upB = mid + 3 * a, dnB = mid - 3 * a, side = lc.c > upB ? 1 : lc.c < dnB ? -1 : 0;
        if (!rec.armed && ((rec.side === 1 && lc.c <= mid) || (rec.side === -1 && lc.c >= mid))) rec.armed = true;   // voltou ao meio
        if (!side || (!rec.armed && side === rec.side)) continue;
        rec.armed = false; rec.side = side;
        if (st.silent || n < cs.length - 1) continue;   // só avisa a vela que acabou de fechar
        out.push({ kind: 'kc', sym, text: `📏 <b>Keltner · ${LBL[id]} · ${esc(sym)}</b>\nA vela fechou ${side === 1 ? 'acima da banda de cima' : 'abaixo da banda de baixo'} do Keltner (±3 ATR): fecho ${fmt(lc.c)}, banda ${fmt(side === 1 ? upB : dnB)}. Preço muito esticado — possível exaustão ${side === 1 ? 'da subida' : 'da descida'}.` });
      }
    }
  }
  // ---------- 7: perto de um alvo de um setup avisado ----------
  function targetAlerts(sym, raw, A, st, now, out) {
    if (!st.tgw || !st.tgw.length) return;
    const any = raw['5m'] || raw['1h'] || raw['4h'] || raw['1d'] || Object.values(raw).find((x) => x && x.length); if (!any || !any.length) return;
    const price = any[any.length - 1].c, pc = Math.max(0.1, +A.tgtPct || 1) / 100;
    st.tgw = st.tgw.filter((x) => {
      if (x.sym !== sym) return true;
      if (now - x.at > 120 * 864e5) return false;
      const up = x.dir === 1;
      if (up ? price < x.origin : price > x.origin) return false;   // passou a origem: setup invalidado
      const reached = up ? price >= x.near * (1 - pc) : price <= x.near * (1 + pc);
      if (!reached) return true;
      if (A.tgtOn && !st.silent) out.push({ kind: 'tgt', sym, tf: x.tf, text: `🎯 <b>Perto do alvo · ${esc(x.name)} · ${esc(sym)}</b>\n${x.tname === 'topo da perna' || x.tname === 'fundo da perna' ? `O preço (${fmt(price)}) chegou perto do ${x.tname} do ${LBL[x.tf]} (${fmt(x.near)})` : `O preço (${fmt(price)}) chegou ao ${x.tname} do ${LBL[x.tf]} (${fmt(x.lo)} – ${fmt(x.hi)})`}. Pensa em realizar ou subir o stop.` });
      return false;
    });
  }
  // ---------- 8: linhas diagonais e canais desenhados (só os com 🔔) ----------
  const lnAt = (l, t) => { const lg = l.p1 > 0 && l.p2 > 0, F = lg ? Math.log : (x) => x, FI = lg ? Math.exp : (x) => x; const k = (t - l.t1) / ((l.t2 - l.t1) || 1); return (off) => FI(F(l.p1) + (F(l.p2) - F(l.p1)) * k + (off || 0)); };
  function lineAlerts(sym, raw, S, A, st, now, out) {
    const ls = ((S.lines || {})[sym] || []).filter((l) => l.alert); if (!A.lineOn || !ls.length) return;
    st.ln = st.ln || {};
    for (const l of ls) {
      const cs = raw[l.tf]; if (!cs || !cs.length) continue;
      const price = cs[cs.length - 1].c, f = lnAt(l, now), pc = (+l.pct || (TF_MS[l.tf] >= 864e5 ? 1 : 0.5)) / 100;
      const sides = l.type === 'chan' ? [['base', f(0)], ['par', f(l.off || 0)]] : [['linha', f(0)]];
      const chHi = l.type === 'chan' ? Math.max(sides[0][1], sides[1][1]) : null;
      for (const [nm, v] of sides) {
        const key = sym + '|' + l.id + '|' + nm, dist = Math.abs(price - v) / v, rec = st.ln[key] || (st.ln[key] = { armed: dist > pc });
        if (!rec.armed) { if (dist > pc * 3) rec.armed = true; continue; }
        if (dist > pc) continue;
        rec.armed = false;
        if (st.silent) continue;
        const what = l.type === 'chan' ? (v === chHi ? 'teto do canal — possível venda ou realização' : 'chão do canal — possível compra') : 'linha diagonal';
        out.push({ kind: 'line', sym, text: `📐 <b>${esc(sym)} · ${LBL[l.tf]}</b>\nA ${pct(dist * 100)} ${l.type === 'chan' ? 'do' : 'da'} ${what} (${fmt(v)}).${l.name ? ' · ' + esc(l.name) : ''}` });
      }
      if (l.type === 'chan') {   // quebra do canal: fecho de uma vela fora
        const cl = cs.filter((c) => c.ct < now), lc = cl[cl.length - 1]; if (!lc) continue;
        const g = lnAt(l, lc.t + (lc.ct - lc.t) / 2), a = g(0), b = g(l.off || 0), hi = Math.max(a, b), lo = Math.min(a, b);
        const key = sym + '|' + l.id + '|out', side = lc.c > hi ? 1 : lc.c < lo ? -1 : 0, rec = st.ln[key] || (st.ln[key] = { side });
        if (side && side !== rec.side && !st.silent) out.push({ kind: 'line', sym, text: `📐 <b>${esc(sym)} · ${LBL[l.tf]}</b>\nFechou ${side === 1 ? 'acima' : 'abaixo'} do canal (${fmt(lc.c)}): quebra ${side === 1 ? 'para cima' : 'para baixo'}.${l.name ? ' · ' + esc(l.name) : ''}` });
        rec.side = side;
      }
    }
  }
  function evaluateAsset(sym, raw, S, A0, edits, st, now) {
    const A = effA(A0, sym), out = [], dm = {};
    const setupTfs = new Set();
    (S.setups || []).filter((x) => x.on && A.setups[x.name] !== false).forEach((x) => { setupTfs.add(x.zone); setupTfs.add(x.trig); if (ctxOf(x)) setupTfs.add(ctxOf(x)); });
    if (A.nearOn) (A.nearTfs || []).forEach((id) => setupTfs.add(id));
    if (A.fibOn) (A.fibTfs || []).forEach((id) => setupTfs.add(id));
    if (FB) [...setupTfs].forEach((id) => { if (FB.NEXT[id] && raw[FB.NEXT[id]]) setupTfs.add(FB.NEXT[id]); });
    for (const id of setupTfs) if (raw[id] && raw[id].length > (MAGG[id] ? 5 : 30)) { try { dm[id] = computeTf(raw[id], id, S, edits[sym + '|' + id] || null, now); } catch (e) {} }
    trackerAlerts(sym, dm, A, st, now, out);   // primeiro os setups já seguidos (podem ser substituídos por uma quebra nova)
    if (A.setupOn) setupAlerts(sym, dm, S, A, st, now, out);
    kzAlerts(sym, raw['5m'], raw['1h'], S, A, st, now, out);
    weekAlerts(sym, raw['1h'], raw['5m'], S, A, st, now, out);
    nearAlerts(sym, dm, A, st, now, out);
    smaAlerts(sym, raw, dm, A, st, now, out);
    targetAlerts(sym, raw, A, st, now, out);
    fibAlerts(sym, dm, A, st, now, out);
    kcAlerts(sym, raw, A, st, now, out);
    lineAlerts(sym, raw, S, A, st, now, out);
    return out;
  }
  function pruneState(st, now) {
    for (const k of Object.keys(st.seen)) if (now - st.seen[k] > 12 * 864e5) delete st.seen[k];
    st.trk = st.trk.filter((x) => now - x.at < 15 * 864e5);
  }

  root.MSS_ALERT_CORE = { anyOn, effA, isRatio, ratioRaw, baseTfs, A_DEF, TF_MS, LBL, MAGG, nyParts, nyOffsetH, fmt, deserEd, earliestEdit, computeTf, aggregateMonths, aggregateSession, neededTfs, levels, evaluateAsset, pruneState, ctxOf, _kc: kcAlerts };
})(typeof window !== 'undefined' ? window : globalThis);

// Ativos sintéticos (índices que não existem na Binance nem na Yahoo), por agora só o STABLE.D = USDT.D + USDC.D.
// Histórico: CSV exportados do TradingView (gravados na conta em meta/sd_<tf>).
// Daqui para a frente: pontos de 5 em 5 minutos gravados pelo vigia a partir da CoinGecko (meta/sd_live),
// acertados à escala do TradingView no ponto em que se juntam.
// Usado pela app (no HTML) e pelo vigia (alertas-motor.js).
(function (root) {
  'use strict';
  const SYN = { 'STABLE.D': { name: 'USDT.D + USDC.D (domínio das stablecoins)', cg: ['usdt', 'usdc'] } };
  const isSynth = (s) => Object.prototype.hasOwnProperty.call(SYN, s);
  const HIST_TFS = ['1M', '1w', '1d', '4h', '1h', '15m'];   // timeframes guardados (o 15m só pela consolidação do vigia)
  const BASE_TFS = ['1M', '1w', '1d', '4h', '1h', '15m', '5m'];
  const MSI = { '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5 };
  const MAGG = { '3M': 3, '6M': 6, '1Y': 12 };
  const KEEP = { '1h': 6000, '15m': 4000, '4h': 4000 };      // velas máximas guardadas por timeframe (o resto, tudo)

  function bucket(tf, t) {
    if (MSI[tf]) return Math.floor(t / MSI[tf]) * MSI[tf];
    const d = new Date(t), day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (tf === '1d') return day;
    if (tf === '1w') return day - ((d.getUTCDay() + 6) % 7) * 864e5;   // semana a começar à segunda (como o TradingView)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  function bucketEnd(tf, b) {
    if (MSI[tf]) return b + MSI[tf] - 1;
    if (tf === '1d') return b + 864e5 - 1;
    if (tf === '1w') return b + 7 * 864e5 - 1;
    const d = new Date(b); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1;
  }
  // CSV do TradingView ("Exportar dados do gráfico") → { tf, rows: [[t(ms), o, h, l, c]] }
  function parseCsv(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
    if (lines.length < 3) throw new Error('ficheiro vazio ou sem velas');
    const head = lines[0].split(',').map((x) => x.trim().toLowerCase().replace(/"/g, ''));
    const ix = (n) => head.indexOf(n);
    const iT = ix('time'), iO = ix('open'), iH = ix('high'), iL = ix('low'), iC = ix('close');
    if ([iT, iO, iH, iL, iC].some((i) => i < 0)) throw new Error('não encontrei as colunas time, open, high, low, close');
    const rows = [];
    for (let k = 1; k < lines.length; k++) {
      const c = lines[k].split(',');
      const tv = c[iT].trim().replace(/"/g, '');
      let t = /^\d+(\.\d+)?$/.test(tv) ? +tv : Date.parse(tv);
      if (!isFinite(t)) continue;
      if (t < 1e12) t *= 1000;
      const r = [t, +c[iO], +c[iH], +c[iL], +c[iC]];
      if (r.slice(1).some((x) => !isFinite(x))) continue;
      rows.push(r.map((x, j) => (j ? Math.round(x * 1e6) / 1e6 : x)));
    }
    rows.sort((a, b) => a[0] - b[0]);
    const out = rows.filter((r, k) => !k || r[0] !== rows[k - 1][0]);
    if (out.length < 3) throw new Error('poucas velas no ficheiro');
    const gaps = out.slice(1).map((r, k) => r[0] - out[k][0]).sort((a, b) => a - b), med = gaps[gaps.length >> 1];
    let tf = null;
    if (med >= 27 * 864e5 && med <= 32 * 864e5) tf = '1M';
    else { const opts = [['5m', 3e5], ['15m', 9e5], ['1h', 36e5], ['4h', 144e5], ['1d', 864e5], ['1w', 6048e5]]; for (const [id, ms] of opts) if (Math.abs(med - ms) / ms < 0.05) tf = id; }
    if (!tf) throw new Error('não reconheci o timeframe (intervalo entre velas: ' + Math.round(med / 6e4) + ' min)');
    return { tf, rows: out };
  }
  // fator de escala: o valor do TradingView no fim do histórico ÷ o valor da CoinGecko nesse momento
  function finest(hist) { return HIST_TFS.slice().reverse().find((tf) => hist[tf] && hist[tf].length) || null; }
  function factorOf(hist, live) {
    const fin = finest(hist); if (!fin || !live || !live.length) return 1;
    const last = hist[fin][hist[fin].length - 1], end = bucketEnd(fin, last[0]);
    let p = null;
    for (const q of live) if (q[0] >= last[0] && q[0] <= end) p = q;   // o último ponto dentro da última vela do histórico
    if (!p) p = live.find((q) => q[0] > end);                            // senão, o primeiro depois dela
    return p && p[1] > 0 && last[4] > 0 ? last[4] / p[1] : 1;
  }
  function aggMonths(cs, k) {
    const out = []; let key = null, cur = null;
    for (const c of cs) {
      const d = new Date(c.t), kk = d.getUTCFullYear() * 12 + Math.floor(d.getUTCMonth() / k) * k;
      if (kk !== key) { key = kk; cur = { t: c.t, ct: c.ct, o: c.o, h: c.h, l: c.l, c: c.c, v: 0 }; out.push(cur); }
      else { cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l); cur.c = c.c; cur.ct = c.ct; }
    }
    if (out.length) { const last = out[out.length - 1], d = new Date(last.t); last.ct = Math.max(last.ct, Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / k) * k + k, 1) - 1); }
    return out;
  }
  // velas por timeframe: histórico + pontos novos (já na escala do TradingView)
  function buildBase(hist, live) {
    const f = factorOf(hist, live), fin = finest(hist);
    const from = fin ? hist[fin][hist[fin].length - 1][0] : 0;
    const pts = (live || []).filter((q) => q[1] > 0).map((q) => [q[0], q[1] * f]);
    const base = {};
    for (const tf of BASE_TFS) {
      const out = (hist[tf] || []).map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: 0 }));
      const min = out.length ? from : -Infinity;   // num TF com histórico, só os pontos depois do fim do histórico mais fino
      for (const [t, v] of pts) {
        if (t < min) continue;
        const b = bucket(tf, t), last = out[out.length - 1];
        if (last && b < last.t) continue;
        if (last && b === last.t) { last.h = Math.max(last.h, v); last.l = Math.min(last.l, v); last.c = v; }
        else { const o = last ? last.c : v; out.push({ t: b, o, h: Math.max(o, v), l: Math.min(o, v), c: v, v: 0 }); }
      }
      out.forEach((c) => { c.ct = bucketEnd(tf, c.t); });
      base[tf] = out;
    }
    return { base, factor: f };
  }
  function build(hist, live, tfIds) {
    const { base } = buildBase(hist, live), out = {};
    for (const id of tfIds) out[id] = MAGG[id] ? aggMonths(base['1M'] || [], MAGG[id]) : base[id] || [];
    return out;
  }
  // consolidação (vigia): passa os pontos com mais de 3 dias para o histórico, para o ficheiro de pontos não crescer
  function consolidate(hist, live, now) {
    const { base } = buildBase(hist, live), nh = {};
    for (const tf of HIST_TFS) { let cs = base[tf] || []; if (KEEP[tf] && cs.length > KEEP[tf]) cs = cs.slice(-KEEP[tf]); nh[tf] = cs.map((c) => [c.t, ...[c.o, c.h, c.l, c.c].map((x) => Math.round(x * 1e6) / 1e6)]); }
    const keepFrom = now - 3 * 864e5;
    return { hist: nh, live: live.filter((q) => q[0] >= keepFrom) };
  }
  // valor atual a partir da resposta /global da CoinGecko
  function cgValue(sym, j) {
    const p = j && j.data && j.data.market_cap_percentage; if (!p) return null;
    let v = 0; for (const k of SYN[sym].cg) { if (!(p[k] > 0)) return null; v += p[k]; }
    return Math.round(v * 1e5) / 1e5;
  }
  // nomes legíveis dos ativos mais comuns (a app e o vigia usam os mesmos)
  const NAMES = { 'GC=F': 'Ouro', 'SI=F': 'Prata', 'PL=F': 'Platina', 'PA=F': 'Paládio', 'HG=F': 'Cobre', 'NG=F': 'Gás natural', 'BZ=F': 'Brent', 'CL=F': 'Petróleo WTI', 'CC=F': 'Cacau', 'ES=F': 'S&P 500', 'NQ=F': 'Nasdaq 100', 'BTCUSDT': 'Bitcoin', 'ETHUSDT': 'Ethereum', 'SOLUSDT': 'Solana', 'XRPUSDT': 'XRP', 'NICK.L': 'Níquel', 'STABLE.D': 'Domínio stablecoins', 'COCO.L': 'Cacau (ETC)' };
  // nomes curtos para os rácios (cabem numa linha: Ouro/Bitcoin, AGAP/BTC…)
  const SHORT = { 'GC=F': 'Ouro', 'SI=F': 'Prata', 'PL=F': 'Platina', 'PA=F': 'Paládio', 'HG=F': 'Cobre', 'NG=F': 'Gás', 'BZ=F': 'Brent', 'CL=F': 'WTI', 'CC=F': 'Cacau', 'ES=F': 'S&P', 'NQ=F': 'Nasdaq', 'BTCUSDT': 'BTC', 'ETHUSDT': 'ETH', 'SOLUSDT': 'SOL', 'XRPUSDT': 'XRP', 'NICK.L': 'Níquel', 'STABLE.D': 'Stable.D', 'COCO.L': 'Cacau ETC' };
  function nameOf(sym, own) {
    const one = (x) => (own && own[x]) || NAMES[x] || x;
    const sh = (x) => (own && own[x] && own[x].length <= 12 ? own[x] : SHORT[x] || String(x).replace(/\.L$/, '').replace(/USDT$/, ''));
    if (own && own[sym]) return own[sym];
    return /^[^/\s]+\/[^/\s]+$/.test(String(sym)) ? String(sym).split('/').map(sh).join('/') : one(sym);
  }
  root.MSS_SYNTH = { NAMES, nameOf, SYN, isSynth, HIST_TFS, parseCsv, build, buildBase, factorOf, consolidate, cgValue, bucket };
})(typeof window !== 'undefined' ? window : globalThis);

// Vigia (Google Apps Script): lê as definições e marcações da conta, vai buscar as velas, corre os alertas e manda para o Telegram.
// Este ficheiro é descarregado do site da app em cada volta (alertas-motor.js), por isso as melhorias chegam sem mexer no Apps Script.
(function (root) {
  'use strict';
  const C = root.MSS_ALERT_CORE, DEF = root.MSS_DEFAULTS, SYN = root.MSS_SYNTH;
  const API_KEY = 'AIzaSyAKXOPF_s_ffOQLIqFS7K-FqEq9G1djRJA', PROJECT = 'scanner-estrutura';
  const FS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
  const BINANCE = 'https://data-api.binance.vision';
  const STOCK_API = 'https://scanner-data.pedrojs70.workers.dev';
  const BUDGET = 45;            // pedidos de velas por volta: 288 voltas × ~50 pedidos cabe na quota diária do Google (20 000)
  const MAX_ASSETS = 12;        // ativos diferentes descarregados por volta (as pernas dos rácios contam uma vez)
  const MAX_AN = 18;            // análises por volta (cada favorito, rácio ou não) — tempo de execução diário do Google: 90 min
  const TIME_MAX = 240e3;       // não começa ativos novos depois de 4 minutos (máximo do Google: 6)
  const isCrypto = (s) => /^[A-Z0-9]{2,20}(USDT|USDC|FDUSD|BTC|ETH|BNB|EUR)$/.test(s) && !s.includes(':');
  const API_IV = { '1M': '1M', '1w': '1w', '1d': '1d', '4h': '4h', '1h': '1h', '15m': '15m', '5m': '5m' };

  function http(url, opt) { const r = UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true }, opt || {})); return { code: r.getResponseCode(), text: r.getContentText() }; }
  function auth(chave) {
    const cache = CacheService.getScriptCache(), c = cache.get('idtok');
    if (c) return JSON.parse(c);
    const r = http('https://securetoken.googleapis.com/v1/token?key=' + API_KEY, { method: 'post', contentType: 'application/x-www-form-urlencoded', payload: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(chave) });
    if (r.code !== 200) throw new Error('a chave não foi aceite (' + r.code + '). Na app, página Alertas, copia de novo o código do vigia e cola-o no Apps Script.');
    const j = JSON.parse(r.text), a = { tok: j.id_token, uid: j.user_id };
    cache.put('idtok', JSON.stringify(a), 3000);
    return a;
  }
  const H = (a) => ({ Authorization: 'Bearer ' + a.tok });
  function fsGet(a, path) {
    const r = http(FS + '/users/' + a.uid + '/' + path, { headers: H(a) });
    if (r.code === 404) return null;
    if (r.code !== 200) throw new Error('conta (' + r.code + ') a ler ' + path);
    const j = JSON.parse(r.text); return j.fields && j.fields.json ? j.fields.json.stringValue : null;
  }
  function fsList(a, col) {
    const out = []; let tok = '';
    for (let g = 0; g < 20; g++) {
      const r = http(FS + '/users/' + a.uid + '/' + col + '?pageSize=300' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''), { headers: H(a) });
      if (r.code !== 200) throw new Error('conta (' + r.code + ') a ler ' + col);
      const j = JSON.parse(r.text); (j.documents || []).forEach((d) => out.push(d.fields || {}));
      if (!j.nextPageToken) break; tok = j.nextPageToken;
    }
    return out;
  }
  function fsSet(a, path, json) {
    const r = http(FS + '/users/' + a.uid + '/' + path, { method: 'patch', contentType: 'application/json', headers: H(a), payload: JSON.stringify({ fields: { json: { stringValue: json }, at: { integerValue: String(Date.now()) } } }) });
    return r.code === 200 ? null : 'conta (' + r.code + ') a gravar ' + path;
  }
  // estado do vigia (o que já foi avisado, setups seguidos): nas propriedades do script, em pedaços
  function loadState() {
    const p = PropertiesService.getScriptProperties(), n = +(p.getProperty('st_n') || 0);
    if (!n) return null;
    let s = ''; for (let i = 0; i < n; i++) s += p.getProperty('st_' + i) || '';
    try { return JSON.parse(s); } catch (e) { return null; }
  }
  function saveState(st) {
    const s = JSON.stringify(st), p = PropertiesService.getScriptProperties(), props = {}, sz = 3000, n = Math.max(1, Math.ceil(s.length / sz));
    for (let i = 0; i < n; i++) props['st_' + i] = s.slice(i * sz, (i + 1) * sz);
    props.st_n = String(n);
    p.setProperties(props);
  }
  // botões por baixo do alerta: abrem a app no ativo / no gráfico maior, no timeframe do alerta
  const APP_URL = 'https://scanner.myfoliotrack.co.uk/';
  function kbd(A, m) {
    if (!m || !m.sym) return null;
    const head = String(m.text || '').split('\n')[0];
    let tf = m.tf || '';
    if (!tf) for (const id of Object.keys(C.LBL)) if (new RegExp('(^|[^\\wÀ-ú])' + C.LBL[id] + '($|[^\\wÀ-ú])').test(head)) { tf = id; break; }
    const base = String(A.appUrl || APP_URL) + '?a=' + encodeURIComponent(m.sym) + (tf ? '&tf=' + tf : '');
    return { inline_keyboard: [[{ text: '📈 Abrir gráfico', url: base + '&v=chart' }, { text: 'Abrir ativo', url: base + '&v=asset' }]] };
  }
  function tg(A, text, m) {
    const url = 'https://api.telegram.org/bot' + A.tgToken + '/sendMessage', body = { chat_id: A.tgChat, text, parse_mode: 'HTML', disable_web_page_preview: true }, kb = kbd(A, m);
    if (kb) body.reply_markup = kb;
    const opt = { method: 'post', contentType: 'application/json', payload: JSON.stringify(body) };
    let r = http(url, opt);
    if (r.code === 429) { Utilities.sleep(1500); r = http(url, opt); }
    return r.code === 200 ? null : 'Telegram ' + r.code + ': ' + r.text.slice(0, 120);
  }

  // ---------- velas ----------
  const rowsOf = (rows) => rows.map((r) => ({ t: r[0], ct: r[6], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }));
  // a Binance costuma recusar os servidores do Google (erro 451/403): nesse caso as velas vêm pelo Worker scanner-data
  let viaProxy = null;
  const binUrl = (q) => (viaProxy ? STOCK_API + '/klines?' : BINANCE + '/api/v3/klines?') + q;
  function pickRoute() {
    if (viaProxy != null) return;
    const p = PropertiesService.getScriptProperties(), saved = p.getProperty('binRoute');
    if (saved && Date.now() - +(saved.split('|')[1] || 0) < 864e5) { viaProxy = saved[0] === 'p'; return; }
    const r = http(BINANCE + '/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1');
    viaProxy = r.code !== 200;
    if (viaProxy) { const q = http(STOCK_API + '/klines?symbol=BTCUSDT&interval=1d&limit=1'); if (q.code !== 200) throw new Error('a Binance recusa o Google (' + r.code + ') e a Cloudflare (' + q.code + '): põe o endereço do intermediário (Vercel) na página Alertas da app'); }
    p.setProperty('binRoute', (viaProxy ? 'p' : 'd') + '|' + Date.now());
  }
  // pelo intermediário no Vercel (Dublin): um pedido por ativo com todos os timeframes
  function relayCandles(relay, syms, tfs, edits) {
    const base = relay.replace(/\/+$/, '') + '/api/velas?';
    const api = [...new Set(tfs.map((id) => (C.MAGG[id] ? '1M' : id)))].filter((id) => API_IV[id]);
    const res = UrlFetchApp.fetchAll(syms.map((s) => ({ url: base + 'symbol=' + s + '&i=' + api.join(',') + '&limit=1000', muteHttpExceptions: true })));
    const out = {};
    const conv = (rows) => rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5], ct: r[6] }));
    res.forEach((r, k) => {
      const s = syms[k], o = (out[s] = {});
      if (r.getResponseCode() !== 200) { o._err = 'intermediário ' + r.getResponseCode(); return; }
      const j = JSON.parse(r.getContentText());
      for (const id of api) {
        const v = j[id];
        if (!Array.isArray(v)) { o._err = (v && v.error) || ('sem velas ' + id); return; }
        let cs = conv(v);
        const need = Math.min(...tfs.filter((t) => (C.MAGG[t] ? '1M' : t) === id).map((t) => C.earliestEdit(edits[s + '|' + t])));
        for (let g = 0; g < 4 && cs.length && need < cs[0].t; g++) {
          const rr = http(base + 'symbol=' + s + '&i=' + id + '&limit=1000&endTime=' + (cs[0].t - 1));
          if (rr.code !== 200) break; const m = JSON.parse(rr.text)[id]; if (!Array.isArray(m) || !m.length) break; cs = conv(m).concat(cs);
        }
        o[id] = cs;
      }
      for (const id of tfs) if (C.MAGG[id] && o['1M']) o[id] = C.aggregateMonths(o['1M'], C.MAGG[id]);
    });
    return out;
  }
  function cryptoCandles(syms, tfs, edits) {
    const reqs = [], keys = [];
    const api = [...new Set(tfs.map((id) => (C.MAGG[id] ? '1M' : id)))].filter((id) => API_IV[id]);
    pickRoute();
    syms.forEach((s) => api.forEach((id) => { reqs.push({ url: binUrl('symbol=' + s + '&interval=' + API_IV[id] + '&limit=1000'), muteHttpExceptions: true }); keys.push([s, id]); }));
    const res = reqs.length ? UrlFetchApp.fetchAll(reqs) : [], out = {};
    res.forEach((r, k) => {
      const [s, id] = keys[k]; out[s] = out[s] || {};
      if (r.getResponseCode() !== 200) { out[s]._err = 'Binance ' + r.getResponseCode() + (viaProxy ? ' (pelo Worker)' : ''); if (!viaProxy) PropertiesService.getScriptProperties().deleteProperty('binRoute'); return; }
      let cs = rowsOf(JSON.parse(r.getContentText()));
      // marcações mais antigas do que as 1000 velas: vai buscar mais história (até 4 páginas)
      const need = Math.min(...tfs.filter((t) => (C.MAGG[t] ? '1M' : t) === id).map((t) => C.earliestEdit(edits[s + '|' + t])));
      for (let g = 0; g < 4 && cs.length && need < cs[0].t; g++) {
        const rr = http(binUrl('symbol=' + s + '&interval=' + API_IV[id] + '&limit=1000&endTime=' + (cs[0].t - 1)));
        if (rr.code !== 200) break; const more = rowsOf(JSON.parse(rr.text)); if (!more.length) break; cs = more.concat(cs);
      }
      out[s][id] = cs;
    });
    for (const s of syms) { const o = out[s] || {}; if (o['1M']) for (const id of tfs) if (C.MAGG[id]) o[id] = C.aggregateMonths(o['1M'], C.MAGG[id]); }
    return out;
  }
  // ações e metais: Yahoo, através do Worker scanner-data (o mesmo que a app usa)
  const Y_IV = { '1M': '1mo', '1w': '1wk', '1d': '1d', '1h': '1h', '15m': '15m', '5m': '5m' };
  const Y_MS = { '1mo': 31 * 864e5, '1wk': 7 * 864e5, '1d': 864e5, '1h': 36e5, '15m': 9e5, '5m': 3e5 };
  const PREFIX = { NASDAQ: '', NYSE: '', AMEX: '', NYSEARCA: '', NYSEAMERICAN: '', CBOE: '', BATS: '', OTC: '', XETR: '.DE', FWB: '.F', GETTEX: '.DE', LSE: '.L', LSIN: '.L', MIL: '.MI', BME: '.MC', SIX: '.SW', OMXSTO: '.ST', OMXHEX: '.HE', OMXCOP: '.CO', OSL: '.OL', TSX: '.TO', ASX: '.AX', VIE: '.VI', WSE: '.WA', ATHEX: '.AT', ISE: '.IR', EURONEXTLISBON: '.LS' };
  function yahooSym(s) {
    const p = PropertiesService.getScriptProperties(), map = JSON.parse(p.getProperty('ymap') || '{}');
    if (map[s]) return map[s];
    let y = s; const m = /^([A-Z]+):(.+)$/.exec(s);
    if (m) {
      if (PREFIX[m[1]] != null) y = m[2].replace(/\./g, '-') + PREFIX[m[1]];
      else {
        const r = http(STOCK_API + '/search?q=' + encodeURIComponent(m[2])), res = r.code === 200 ? (JSON.parse(r.text).results || []) : [];
        const hit = res.find((x) => x.type === 'EQUITY' && x.symbol.split('.')[0] === m[2] && /\.(AS|PA|BR|LS|IR|OL)$/.test(x.symbol)) || res.find((x) => x.symbol.split('.')[0] === m[2]) || res[0];
        y = hit ? hit.symbol : m[2];
      }
    }
    map[s] = y; p.setProperty('ymap', JSON.stringify(map)); return y;
  }
  function stockCandles(sym, tfs) {
    const y = yahooSym(sym), ivs = new Set();
    tfs.forEach((id) => { if (Y_IV[id]) ivs.add(Y_IV[id]); if (id === '4h') ivs.add('1h'); if (C.MAGG[id]) ivs.add('1mo'); });
    if (!ivs.size) return {};
    const r = http(STOCK_API + '/candles?s=' + encodeURIComponent(y) + '&i=' + [...ivs].join(','));
    if (r.code !== 200) return { _err: 'Yahoo ' + r.code };
    const got = JSON.parse(r.text)[y] || {}, out = {};
    for (const id of tfs) {
      const iv = Y_IV[id] || (id === '4h' ? '1h' : C.MAGG[id] ? '1mo' : null); if (!iv || !got[iv] || !got[iv].rows) continue;
      const rows = got[iv].rows;
      let cs = rows.map((q, k) => ({ t: q[0], ct: (rows[k + 1] ? rows[k + 1][0] : q[0] + Y_MS[iv]) - 1, o: q[1], h: q[2], l: q[3], c: q[4], v: q[5] }));
      if (id === '4h') cs = C.aggregateSession(cs, 4);
      if (C.MAGG[id]) cs = C.aggregateMonths(cs, C.MAGG[id]);
      out[id] = cs;
    }
    return out;
  }

  // ---------- ativos sintéticos (STABLE.D): um ponto da CoinGecko por volta; histórico na conta ----------
  function synthHist(a) {
    const h = {};
    for (const tf of SYN.HIST_TFS) { const j = fsGet(a, 'meta/sd_' + tf); if (j) { try { h[tf] = JSON.parse(j); } catch (e) {} } }
    return h;
  }
  function synthRecord(a, A, hb, now) {
    const r = http('https://api.coingecko.com/api/v3/global' + (A.cgKey ? '?x_cg_demo_api_key=' + encodeURIComponent(A.cgKey) : ''));
    let live = []; try { live = JSON.parse(fsGet(a, 'meta/sd_live') || '[]'); } catch (e) {}
    if (r.code !== 200) hb.err.push('CoinGecko ' + r.code + (A.cgKey ? '' : ' — põe a chave grátis na página Alertas'));
    else { const v = SYN.cgValue('STABLE.D', JSON.parse(r.text)); if (v == null) hb.err.push('CoinGecko sem domínio USDT/USDC'); else live.push([now, v]); }
    let hist = null;
    // uma vez por dia: os pontos com mais de 3 dias passam para o histórico (o ficheiro de pontos fica pequeno)
    if (live.length && now - live[0][0] > 4 * 864e5) {
      hist = synthHist(a);
      const c = SYN.consolidate(hist, live, now);
      for (const tf of SYN.HIST_TFS) if (c.hist[tf] && c.hist[tf].length) { const e = fsSet(a, 'meta/sd_' + tf, JSON.stringify(c.hist[tf])); if (e) hb.err.push(e); }
      hist = c.hist; live = c.live;
    }
    const e = fsSet(a, 'meta/sd_live', JSON.stringify(live)); if (e) hb.err.push(e);
    return { live, hist };
  }

  // ---------- uma volta ----------
  function vigiar(cfg) {
    const t0 = Date.now(), now = t0;
    const a = auth(cfg.chave);
    const sj = fsGet(a, 'meta/settings');
    const S = Object.assign({}, DEF, sj ? JSON.parse(sj) : {});
    const A = Object.assign({}, C.A_DEF, S.alerts || {}); A.setups = A.setups || {};
    let st = loadState();
    const first = !st;
    st = st || { seen: {}, trk: [], cur: 0, known: {}, log: [] };
    st.known = st.known || {}; st.log = st.log || [];
    const favs = (S.favs || []).slice();
    const hb = { lastRun: now, favs: favs.length, done: [], err: [] };
    if (!A.on || !A.tgToken || !A.tgChat) {
      hb.off = !A.on ? 'alertas desligados na app' : 'falta ligar o Telegram na app';
      fsSet(a, 'meta/alertlog', JSON.stringify(Object.assign(hb, { log: st.log }))); saveState(st); return hb;
    }
    st.trk = st.trk.filter((x) => favs.indexOf(x.sym) >= 0);
    const edits = {};
    try { fsList(a, 'edits').forEach((f) => { const k = f.key && f.key.stringValue, j = f.json && f.json.stringValue; if (k && j) { try { edits[k] = C.deserEd(JSON.parse(j)); } catch (e) {} } }); }
    catch (e) { hb.err.push(String(e.message || e)); }
    const tfs = C.neededTfs(S, A);
    const relay = String(A.relay || '').trim();
    // cada favorito é uma análise; cada ativo diferente (as pernas dos rácios incluídas) é um download, feito uma só vez por volta
    const legsOf = (s) => (C.isRatio(s) ? s.split('/') : [s]);
    const syn = favs.some(SYN.isSynth) ? synthRecord(a, A, hb, now) : null;
    const anyRatio = favs.some(C.isRatio), ftfs = anyRatio ? [...new Set(tfs.concat(C.baseTfs(tfs)))] : tfs;
    const costOf = (s) => (isCrypto(s) && !relay ? new Set(ftfs.map((id) => (C.MAGG[id] ? '1M' : id))).size : 1);
    // primeiro os ativos com setups a seguir (o toque no FVG não pode esperar), depois os outros à vez
    // só os favoritos com algum alerta ligado são analisados (os outros ficam só na app)
    const act = favs.filter((s) => C.anyOn(A, s, S) || st.trk.some((x) => x.sym === s) || (st.tgw || []).some((x) => x.sym === s));
    hb.act = act.length;
    const order = [...new Set(st.trk.map((x) => x.sym))].filter((s) => act.indexOf(s) >= 0);
    for (let k = 0; k < act.length; k++) { const s = act[(st.cur + k) % act.length]; if (order.indexOf(s) < 0) order.push(s); }
    const batch = [], dl = new Set(); let used = 0;
    for (const s of order) {
      const nw = legsOf(s).filter((x) => !dl.has(x)), c = nw.reduce((n, x) => n + costOf(x), 0);
      if (batch.length && (used + c > BUDGET || dl.size + nw.length > MAX_ASSETS || batch.length >= MAX_AN)) break;
      batch.push(s); nw.forEach((x) => dl.add(x)); used += c;
    }
    const rotated = batch.filter((s) => !st.trk.some((x) => x.sym === s)).length;
    st.cur = act.length ? (st.cur + Math.max(1, rotated)) % act.length : 0;
    hb.dl = dl.size; hb.an = batch.length; hb.maxDl = MAX_ASSETS; hb.maxAn = MAX_AN;
    hb.needDl = new Set([].concat(...act.map(legsOf))).size;
    const legs = [...dl], crypto = legs.filter(isCrypto);
    let synH = syn && syn.hist;
    const cdata = crypto.length ? (relay ? relayCandles(relay, crypto, ftfs, edits) : cryptoCandles(crypto, ftfs, edits)) : {};
    const sdata = {};
    const legData = (x) => { if (SYN.isSynth(x)) { if (!syn) return { _err: 'sem dados' }; if (!synH) synH = synthHist(a); if (!Object.keys(synH).length && !syn.live.length) return { _err: 'importa o histórico (CSV do TradingView) na app' }; return SYN.build(synH, syn.live, ftfs); } if (isCrypto(x)) return cdata[x] || { _err: 'sem dados' }; if (!sdata[x]) { try { sdata[x] = stockCandles(x, ftfs); } catch (e) { sdata[x] = { _err: String(e.message || e) }; } } return sdata[x]; };
    const msgs = [];
    for (const s of batch) {
      if (Date.now() - t0 > TIME_MAX) { hb.err.push('sem tempo para ' + s); break; }
      try {
        let raw;
        if (C.isRatio(s)) { const [A1, B1] = s.split('/'); raw = C.ratioRaw(legData(A1), legData(B1), tfs, isCrypto(A1) || !isCrypto(B1)); }
        else raw = legData(s);
        if (raw._err) { hb.err.push(s + ': ' + raw._err); continue; }
        st.silent = first || !st.known[s];
        const out = C.evaluateAsset(s, raw, S, A, edits, st, now);
        st.known[s] = st.known[s] || now;
        out.forEach((m) => msgs.push(m));
        hb.done.push(s);
      } catch (e) { hb.err.push(s + ': ' + (e.message || e)); }
    }
    st.silent = false;
    if (first) msgs.push({ kind: 'info', sym: '', text: '✅ <b>Vigia ligado</b>\nA vigiar ' + favs.length + ' favoritos de 5 em 5 minutos. A partir de agora recebes aqui os alertas que escolheste na app.' });
    const own = Object.assign({}, S.autoNames || {}, S.names || {});
    for (const m of msgs) {
      if (m.sym) { const n = SYN.nameOf(m.sym, own); if (n && n !== m.sym) m.text = m.text.split('· ' + m.sym + '</b>').join('· ' + n + ' (' + m.sym + ')</b>').split('<b>' + m.sym + ' ·').join('<b>' + n + ' (' + m.sym + ') ·'); }
      const e = tg(A, m.text, m); if (e) hb.err.push(e);
      st.log.unshift({ at: now, kind: m.kind, sym: m.sym, text: m.text });
    }
    st.log = st.log.slice(0, 80);
    C.pruneState(st, now);
    for (const k of Object.keys(st.known)) if (favs.indexOf(k) < 0) delete st.known[k];
    if (st.sma) for (const k of Object.keys(st.sma)) if (favs.indexOf(k.split('|')[0]) < 0) delete st.sma[k];
    if (st.ln) for (const k of Object.keys(st.ln)) if (favs.indexOf(k.split('|')[0]) < 0) delete st.ln[k];
    if (st.tgw) st.tgw = st.tgw.filter((x) => favs.indexOf(x.sym) >= 0);
    for (const o of [st.fibz, st.kc]) if (o) for (const k of Object.keys(o)) if (favs.indexOf(k.split('|')[0]) < 0) delete o[k];
    saveState(st);
    hb.ms = Date.now() - t0;
    const e = fsSet(a, 'meta/alertlog', JSON.stringify(Object.assign(hb, { log: st.log })));
    if (e) console.log(e);
    return hb;
  }
  function testar(cfg) {
    const a = auth(cfg.chave), sj = fsGet(a, 'meta/settings'), S = Object.assign({}, DEF, sj ? JSON.parse(sj) : {});
    const A = Object.assign({}, C.A_DEF, S.alerts || {});
    if (!A.tgToken || !A.tgChat) throw new Error('falta ligar o Telegram na página Alertas da app');
    const e = tg(A, '🔔 <b>Teste do vigia</b>\nO Apps Script consegue ler a tua conta e falar com o Telegram. Favoritos: ' + (S.favs || []).length + '.');
    if (e) throw new Error(e);
    return 'ok';
  }
  function reset() { PropertiesService.getScriptProperties().deleteAllProperties(); CacheService.getScriptCache().remove('idtok'); }
  root.MSS_ALERTAS = { vigiar, testar, reset, version: '1' };
})(typeof window !== 'undefined' ? window : globalThis);
