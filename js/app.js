/* ============================================================
   EKANTIK - the page's behaviour.

   Kept out of the HTML so the Content-Security-Policy can forbid
   inline scripts. Loaded with `defer`, so the DOM is ready.
   ============================================================ */
(() => {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);

  /* only dim text for the reveal when it can be revealed again */
  const canReveal = 'IntersectionObserver' in window;
  if (canReveal) root.classList.add('js');

  /* ---- prices: change these two and every price on the page follows ---- */
  const MRP = 5999;     /* full price, rupees */
  const PRICE = 1999;   /* early bird price, rupees */
  const rupees = (n) => '₹' + n.toLocaleString('en-IN');
  document.querySelectorAll('[data-price]').forEach((el) => { el.textContent = rupees(PRICE); });
  document.querySelectorAll('[data-mrp]').forEach((el) => { el.textContent = rupees(MRP); });
  document.querySelectorAll('[data-save]').forEach((el) => { el.textContent = 'Save ' + rupees(MRP - PRICE); });

  /* ---- reveals: dim to full as each line arrives ---- */
  if (canReveal) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.2, rootMargin: '0px 0px -6% 0px' });
    document.querySelectorAll('.r').forEach((el) => io.observe(el));

    /* the count-up, only once it is seen */
    const num = $('statNum');
    new IntersectionObserver((es, ob) => {
      if (!es[0].isIntersecting || reduced) return;
      ob.disconnect();
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 1800);
        num.textContent = k < 1 ? Math.round(70 * (1 - Math.pow(1 - k, 3))) : '70–80';
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, { threshold: 0.5 }).observe(num);
  }

  /* ---- mobile menu ---- */
  const menuBtn = $('menuBtn'), menu = $('menu');
  const setMenu = (open) => {
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.hidden = !open;
    document.body.classList.toggle('menu-open', open);
  };
  menuBtn.addEventListener('click', () => setMenu(menuBtn.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); menuBtn.focus(); } });
  matchMedia('(min-width: 901px)').addEventListener('change', (m) => { if (m.matches) setMenu(false); });

  /* ---- the sky: scrolling is the hour before dawn ----
     --p is set on the sky alone; on :root it restyled the whole page
     on every scroll frame */
  const sky = document.querySelector('.sky');
  const craft = $('craft');
  const steps = craft.querySelectorAll('.craft__steps p');
  const tabs = craft.querySelectorAll('.craft__tabs li');
  const LOOKS = ['wire', 'clay', 'real'];
  const bar = $('craftBar');
  let craftStage = null, ticking = false, skyP = 0, lastIdx = -1;
  function onScroll() {
    ticking = false;
    const max = root.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, scrollY / max) : 0;
    skyP = p * p;
    sky.style.setProperty('--p', skyP.toFixed(3));

    const r = craft.getBoundingClientRect();
    const a = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight)));
    bar.style.setProperty('--a', a.toFixed(3));
    const idx = a < 0.38 ? 0 : a < 0.72 ? 1 : 2;
    if (idx !== lastIdx) {
      steps.forEach((s, i) => s.classList.toggle('on', i === idx));
      tabs.forEach((s, i) => s.classList.toggle('on', i === idx));
      lastIdx = idx;
    }
    if (craftStage) { craftStage.setProgress(a); craftStage.setLook(LOOKS[idx]); }
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();

  /* ---- stars, fading as the sky lightens; ~30fps, and idle once gone ---- */
  const cv = $('stars'), cx = cv.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const S = [];
  const sizeStars = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; draw(performance.now()); };
  for (let i = 0; i < 110; i++) S.push({ x: Math.random(), y: Math.random() * .8, r: (.3 + Math.random() * 1.1) * dpr, a: .15 + Math.random() * .6, ph: Math.random() * 6.3 });
  function draw(t) {
    const fade = 1 - skyP;
    cx.clearRect(0, 0, cv.width, cv.height);
    if (fade < 0.02) return;
    cx.fillStyle = '#f6eedf';
    for (const s of S) {
      cx.globalAlpha = s.a * fade * (reduced ? 1 : .65 + .35 * Math.sin(t / 1400 + s.ph));
      cx.beginPath(); cx.arc(s.x * cv.width, s.y * cv.height, s.r, 0, 6.283); cx.fill();
    }
  }
  let lastStar = 0;
  function twinkle(t) {
    requestAnimationFrame(twinkle);
    if (t - lastStar < 33) return;
    lastStar = t;
    draw(t);
  }
  addEventListener('resize', sizeStars);
  sizeStars();
  if (reduced) addEventListener('scroll', () => requestAnimationFrame(draw), { passive: true });
  else requestAnimationFrame(twinkle);

  /* ---- sound: an opt-in drone, and a singing bowl on each breath ---- */
  let ac = null, master = null, soundOn = false;
  const soundBtns = document.querySelectorAll('.js-sound');
  function bowl(freq) {
    if (!ac || !soundOn) return;
    const t = ac.currentTime;
    [1, 2.76, 5.4].forEach((m, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = freq * m;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16 / (i + 1), t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 7 - i * 1.5);
      o.connect(g).connect(master); o.start(t); o.stop(t + 7.2);
    });
  }
  function toggleSound() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    soundOn = !soundOn;
    if (!ac) {
      ac = new Ctx();
      master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
      /* a low drone at 136.1 Hz, the pitch often tuned to Om, with its fifth */
      [136.1, 204.15].forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = f; g.gain.value = i ? 0.035 : 0.07;
        const lfo = ac.createOscillator(), lg = ac.createGain();
        lfo.frequency.value = 0.125; lg.gain.value = 0.025;
        lfo.connect(lg).connect(g.gain);
        o.connect(g).connect(master); o.start(); lfo.start();
      });
    }
    ac.resume();
    master.gain.cancelScheduledValues(ac.currentTime);
    master.gain.setTargetAtTime(soundOn ? 0.9 : 0, ac.currentTime, 1.2);
    soundBtns.forEach((b) => {
      b.setAttribute('aria-pressed', String(soundOn));
      b.textContent = soundOn ? 'Sound on' : 'Sound off';
    });
    if (soundOn) bowl(432);
  }
  soundBtns.forEach((b) => b.addEventListener('click', toggleSound));
  /* the drone stops with the tab, so it never plays from a hidden page */
  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    if (document.hidden) ac.suspend(); else if (soundOn) ac.resume();
  });

  /* ---- one guided breath: in 4, hold 2, out 6, three times ---- */
  const orb = $('orb'), word = $('orbWord'), begin = $('begin'), after = $('after');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  begin.addEventListener('click', async () => {
    begin.disabled = true; after.classList.remove('show');
    for (let i = 0; i < 3; i++) {
      bowl(i === 2 ? 384 : 432);
      word.textContent = 'breathe in';
      orb.style.transitionDuration = '4s'; orb.style.transform = 'scale(2.6)';
      await wait(4000);
      word.textContent = 'hold';
      await wait(2000);
      word.textContent = 'let go';
      orb.style.transitionDuration = '6s'; orb.style.transform = 'scale(1)';
      await wait(6000);
    }
    word.textContent = '';
    after.classList.add('show');
    await wait(2500);
    begin.textContent = 'Again'; begin.disabled = false;
  });

  /* ---- the order ---- */
  const NAMES = { midnight: 'Midnight', ash: 'Ash', sandal: 'Sandal' };
  const buy = $('buy'), qtyOut = $('qty');
  const MAX_QTY = 5;
  let qty = 1, configStage = null;
  const order = () => ({
    finish: NAMES[buy.finish.value] ? buy.finish.value : 'sandal',
    size: buy.size.value === 'help' ? 'Help me choose' : buy.size.value,
    qty, total: PRICE * qty
  });
  function refresh() {
    qtyOut.textContent = qty;
    $('qMinus').disabled = qty <= 1;
    $('qPlus').disabled = qty >= MAX_QTY;
    $('total').textContent = rupees(PRICE * qty);
    $('viewLabel').textContent = NAMES[order().finish];
    if (configStage) configStage.setFinish(order().finish);
  }
  $('qMinus').addEventListener('click', () => { qty = Math.max(1, qty - 1); refresh(); });
  $('qPlus').addEventListener('click', () => { qty = Math.min(MAX_QTY, qty + 1); refresh(); });
  buy.addEventListener('change', refresh);
  refresh();

  const dlg = $('checkout');
  const coForm = $('coForm'), coReview = $('coReview'), coDone = $('coDone');
  const coSummary = $('coSummary'), coErr = $('coErr');
  const openDialog = () => { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); };
  const closeDialog = () => { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); };
  const show = (step) => {
    coForm.hidden = step !== 1; coReview.hidden = step !== 2; coDone.hidden = step !== 3;
    coSummary.hidden = step === 3;
    $('coStep').textContent = step === 3 ? 'Reserved' : 'Step ' + step + ' of 2';
    $('coTitle').textContent = step === 1 ? 'Where should we write?' : step === 2 ? 'Check your reservation' : 'The quiet hour is yours';
  };
  /* every value a visitor typed is set with textContent, never as HTML */
  const row = (k, v) => {
    const d = document.createElement('div'), a = document.createElement('span'), b = document.createElement('span');
    a.textContent = k; b.textContent = v; d.append(a, b); return d;
  };
  function fillSummary() {
    const o = order();
    const due = row('Due today', rupees(0)); due.className = 'sum-total';
    coSummary.replaceChildren(
      row('Ekantik, first edition', NAMES[o.finish]),
      row('Size', o.size),
      row('Quantity', String(o.qty)),
      due,
      row('Early bird saving', '−' + rupees((MRP - PRICE) * o.qty)),
      row('Due when it ships', rupees(o.total))
    );
  }
  buy.addEventListener('submit', (e) => {
    e.preventDefault();
    fillSummary(); show(1); clearErrors();
    openDialog();
    $('coName').focus();
  });
  $('coClose').addEventListener('click', closeDialog);
  $('coDoneClose').addEventListener('click', closeDialog);
  $('coBack').addEventListener('click', () => show(1));
  /* a click on the dimmed backdrop closes it too */
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(); });

  const val = (id) => $(id).value.trim();
  const FIELDS = ['coName', 'coEmail', 'coPhone', 'coCity'];
  function clearErrors() {
    coErr.textContent = '';
    FIELDS.forEach((id) => $(id).removeAttribute('aria-invalid'));
  }
  function fail(id, msg) {
    coErr.textContent = msg;
    $(id).setAttribute('aria-invalid', 'true');
    $(id).focus();
  }
  coForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors();
    const name = val('coName'), email = val('coEmail'), city = val('coCity'), phone = val('coPhone');
    if (!name) return fail('coName', 'Add your name so we know who to write to.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('coEmail', 'Enter a full email address, like name@example.com.');
    if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) return fail('coPhone', 'Use digits only for the phone number, like +91 98765 43210, or leave it empty.');
    if (!city) return fail('coCity', 'Add your city so we can plan delivery.');
    $('coWho').replaceChildren(row('Name', name), row('Email', email), row('City', city), ...(phone ? [row('Phone', phone)] : []));
    show(2);
  });
  $('coConfirm').addEventListener('click', () => {
    $('coThanks').textContent = 'Thank you, ' + val('coName').split(/\s+/)[0] + '.';
    $('coRef').textContent = 'EK-' + String(Math.floor(100000 + Math.random() * 900000));
    $('coNext').textContent = 'We will write to ' + val('coEmail') + ' before anything is charged.';
    show(3);
  });

  /* ---- the 3D ring, three times; the page reads fine without it ---- */
  const gl = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; } })();
  if (gl) {
    import('./stage.js').then(({ mountRing }) => {
      root.classList.add('js-3d');
      mountRing($('heroRing'), { mode: 'hero', finish: 'sandal' });
      craftStage = mountRing($('craftRing'), { mode: 'design', finish: 'sandal', label: 'The ring shown as it is designed: first a drawn mesh, then a clay prototype, then the finished piece.' });
      configStage = mountRing($('configRing'), { mode: 'config', finish: order().finish });
      onScroll(); refresh();
    }).catch((err) => console.error('3D view unavailable:', err));
  }
})();
