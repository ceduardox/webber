const BASE_PRICE = 320;
const MIN_PRICE = 170;
const MAX_DISCOUNT = 150;
const WHATSAPP_NUMBER = "59160932596";
const QUIZ_QUESTIONS = [
  {
    id: "diabetes_status",
    text: "Tienes diagnostico de diabetes tipo 2 o prediabetes?",
    hint: "Si ya tienes diagnostico, este apoyo debe acompanarse con control medico.",
    image: "/assets/quiz-metabolismo.svg?v=2",
    alt: "Persona revisando salud metabolica",
  },
  {
    id: "sugar_spikes",
    text: "Te gustaria reducir picos de azucar despues de las comidas?",
    hint: "Muchos usuarios buscan estabilidad glucemica para sentirse mejor durante el dia.",
    image: "/assets/quiz-azucar.svg?v=2",
    alt: "Persona monitoreando niveles de azucar",
  },
  {
    id: "insulin_support",
    text: "Quieres apoyo en energia y control de peso asociado a resistencia a la insulina?",
    hint: "La berberina suele integrarse a habitos saludables para apoyo metabolico.",
    image: "/assets/quiz-peso.svg?v=2",
    alt: "Persona enfocada en control de peso",
  },
];

const state = {
  quizIndex: 0,
  quizAnswers: [],
  knowledgeScore: 0,
  currentDiscount: 0,
  finalDiscount: 0,
  finalPrice: BASE_PRICE,
  game: {
    timer: 10,
    countdownInterval: null,
    spawnInterval: null,
    specialInterval: null,
    specialCoinSpawned: false,
  },
  urgencySeconds: 8 * 60,
  urgencyInterval: null,
};

const sessionAnalytics = {
  startedAtMs: Date.now(),
  startedAtPerf: performance.now(),
  sessionClosed: false,
  buttonClicks: 0,
  firstClickMs: null,
  primaryCtaClicked: false,
  clickedButtons: {},
};

const screens = Array.from(document.querySelectorAll(".screen"));
const heroCta = document.querySelector("#heroCta");
const quizStep = document.querySelector("#quizStep");
const quizPercent = document.querySelector("#quizPercent");
const quizProgressBar = document.querySelector("#quizProgressBar");
const quizImage = document.querySelector("#quizImage");
const quizQuestion = document.querySelector("#quizQuestion");
const quizHint = document.querySelector("#quizHint");
const answerYes = document.querySelector("#answerYes");
const answerNo = document.querySelector("#answerNo");
const benefitsCta = document.querySelector("#benefitsCta");
const loadingBar = document.querySelector("#loadingBar");
const loadingPercent = document.querySelector("#loadingPercent");
const gameZone = document.querySelector("#gameZone");
const gameTimer = document.querySelector("#gameTimer");
const gameDiscount = document.querySelector("#gameDiscount");
const rewardDiscount = document.querySelector("#rewardDiscount");
const rewardFinalPrice = document.querySelector("#rewardFinalPrice");
const rewardCta = document.querySelector("#rewardCta");
const confettiLayer = document.querySelector("#confettiLayer");
const urgencyTimer = document.querySelector("#urgencyTimer");
const toCheckoutCta = document.querySelector("#toCheckoutCta");
const checkoutPrice = document.querySelector("#checkoutPrice");
const checkoutForm = document.querySelector("#checkoutForm");
const submitOrderBtn = document.querySelector("#submitOrderBtn");
const formMessage = document.querySelector("#formMessage");

function triggerBump(element) {
  if (!element) return;
  element.classList.remove("bump");
  // Force reflow to restart animation.
  void element.offsetWidth;
  element.classList.add("bump");
}

function initButtonEffects() {
  const buttons = document.querySelectorAll(".btn");
  buttons.forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const rect = button.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const ripple = document.createElement("span");
      ripple.className = "btn-ripple";
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - rect.left}px`;
      ripple.style.top = `${event.clientY - rect.top}px`;
      button.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    });
  });
}

function trackEvent(eventName, eventData = {}) {
  const payload = {
    event_name: eventName,
    event_data: eventData,
    page: window.location.pathname,
  };

  fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // Analytics should never block conversion flow.
  });
}

function trackButtonPress(buttonId, isPrimary = false) {
  sessionAnalytics.buttonClicks += 1;
  sessionAnalytics.clickedButtons[buttonId] = (sessionAnalytics.clickedButtons[buttonId] || 0) + 1;
  if (sessionAnalytics.firstClickMs === null) {
    sessionAnalytics.firstClickMs = Math.round(performance.now() - sessionAnalytics.startedAtPerf);
  }
  if (isPrimary) {
    sessionAnalytics.primaryCtaClicked = true;
  }

  trackEvent("button_click", {
    button_id: buttonId,
    click_count_for_button: sessionAnalytics.clickedButtons[buttonId],
    total_button_clicks: sessionAnalytics.buttonClicks,
  });
}

function sendSessionEnd(reason) {
  if (sessionAnalytics.sessionClosed) return;
  sessionAnalytics.sessionClosed = true;

  const dwellMs = Math.max(0, Date.now() - sessionAnalytics.startedAtMs);
  const payload = {
    event_name: "session_end",
    event_data: {
      reason,
      dwell_ms: dwellMs,
      dwell_seconds: Math.round(dwellMs / 1000),
      total_button_clicks: sessionAnalytics.buttonClicks,
      primary_cta_clicked: sessionAnalytics.primaryCtaClicked,
      first_click_ms: sessionAnalytics.firstClickMs,
      clicked_buttons: sessionAnalytics.clickedButtons,
    },
    page: window.location.pathname + window.location.search,
  };
  const body = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon("/api/analytics", blob);
    return;
  }

  fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

function initSessionTracking() {
  trackEvent("session_start", {
    started_at: new Date(sessionAnalytics.startedAtMs).toISOString(),
    page: window.location.pathname + window.location.search,
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      sendSessionEnd("hidden");
    }
  });
  window.addEventListener("pagehide", () => sendSessionEnd("pagehide"));
  window.addEventListener("beforeunload", () => sendSessionEnd("beforeunload"));
}

function showScreen(id) {
  screens.forEach((screen) => {
    screen.classList.toggle("active", screen.id === id);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateQuiz() {
  const question = QUIZ_QUESTIONS[state.quizIndex];
  const step = state.quizIndex + 1;
  const percent = Math.round((step / QUIZ_QUESTIONS.length) * 100);

  quizStep.textContent = `Paso ${step} de ${QUIZ_QUESTIONS.length}`;
  quizPercent.textContent = `${percent}%`;
  quizProgressBar.style.width = `${percent}%`;
  quizQuestion.textContent = question.text;
  quizHint.textContent = question.hint;
  quizImage.src = question.image;
  quizImage.alt = question.alt;
}

function calculateKnowledgeScore(answers) {
  const questionWeights = {
    diabetes_status: 35,
    sugar_spikes: 40,
    insulin_support: 25,
  };
  const answerMultiplier = {
    si: 1,
    quiero_mas_info: 0.55,
  };

  let score = 0;
  for (const item of answers) {
    const weight = questionWeights[item.question_id] || 0;
    const multiplier = answerMultiplier[item.answer] || 0;
    score += weight * multiplier;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function handleQuizAnswer(answer) {
  state.quizAnswers.push({
    question_id: QUIZ_QUESTIONS[state.quizIndex].id,
    answer,
  });

  state.quizIndex += 1;

  if (state.quizIndex >= QUIZ_QUESTIONS.length) {
    state.knowledgeScore = calculateKnowledgeScore(state.quizAnswers);
    trackEvent("quiz_complete", {
      answers: state.quizAnswers,
      knowledge_score: state.knowledgeScore,
    });
    showScreen("screen-benefits");
    return;
  }

  updateQuiz();
}

function runLoadingStep() {
  showScreen("screen-loading");
  let current = 0;
  loadingBar.style.width = "0%";
  loadingPercent.textContent = "0%";

  const interval = setInterval(() => {
    current += 4;
    if (current > 100) current = 100;
    loadingBar.style.width = `${current}%`;
    loadingPercent.textContent = `${current}%`;

    if (current === 100) {
      clearInterval(interval);
      startGame();
    }
  }, 95);
}

function spawnCoin(value = 5, isGold = false) {
  const coin = document.createElement("button");
  const sizeOffset = isGold ? 62 : 56;
  const maxLeft = Math.max(0, gameZone.clientWidth - sizeOffset);
  const left = Math.floor(Math.random() * (maxLeft + 1));

  coin.type = "button";
  coin.className = `coin${isGold ? " coin--gold" : ""}`;
  coin.style.left = `${left}px`;
  coin.style.animationDuration = `${(2.1 + Math.random() * 1.2).toFixed(2)}s`;
  coin.dataset.value = String(value);
  coin.textContent = `-${value}`;

  coin.addEventListener("click", () => {
    const coinValue = Number(coin.dataset.value) || 0;
    state.currentDiscount += coinValue;
    if (state.currentDiscount > MAX_DISCOUNT) state.currentDiscount = MAX_DISCOUNT;
    gameDiscount.textContent = `${state.currentDiscount} Bs`;
    triggerBump(gameDiscount);
    showCoinPop(coin.offsetLeft + coin.clientWidth / 2, coin.offsetTop + 16, coinValue);
    coin.remove();
  });

  coin.addEventListener("animationend", () => coin.remove());
  gameZone.appendChild(coin);
}

function showCoinPop(x, y, value) {
  const pop = document.createElement("span");
  pop.className = "coin-pop";
  pop.style.left = `${x}px`;
  pop.style.top = `${y}px`;
  pop.textContent = `+${value} Bs`;
  gameZone.appendChild(pop);
  setTimeout(() => pop.remove(), 650);
}

function clearGameIntervals() {
  clearInterval(state.game.countdownInterval);
  clearInterval(state.game.spawnInterval);
  clearInterval(state.game.specialInterval);
  state.game.countdownInterval = null;
  state.game.spawnInterval = null;
  state.game.specialInterval = null;
}

function finalizeGame() {
  clearGameIntervals();
  gameZone.querySelectorAll(".coin, .coin-pop").forEach((el) => el.remove());

  const guaranteedFloor = 22;
  const normalizedDiscount = Math.max(state.currentDiscount, guaranteedFloor);
  state.finalDiscount = Math.min(MAX_DISCOUNT, normalizedDiscount);
  state.finalPrice = Math.max(MIN_PRICE, BASE_PRICE - state.finalDiscount);

  rewardDiscount.textContent = `${state.finalDiscount} Bs`;
  rewardFinalPrice.textContent = `${state.finalPrice} Bs`;
  checkoutPrice.textContent = `${state.finalPrice} Bs`;

  trackEvent("game_finish", {
    discount_collected: state.currentDiscount,
    discount_final: state.finalDiscount,
    final_price: state.finalPrice,
  });
  trackEvent("discount_unlocked", { discount: state.finalDiscount, final_price: state.finalPrice });

  showScreen("screen-reward");
  launchConfetti();
}

function startGame() {
  showScreen("screen-game");
  trackEvent("game_start");

  state.currentDiscount = 0;
  state.game.timer = 10;
  state.game.specialCoinSpawned = false;
  gameDiscount.textContent = "0 Bs";
  gameTimer.textContent = String(state.game.timer);
  gameZone.innerHTML = "";

  state.game.spawnInterval = setInterval(() => {
    const random = Math.random();
    if (random < 0.45) spawnCoin(5);
    else if (random < 0.82) spawnCoin(10);
    else spawnCoin(15);
  }, 360);

  const gameStartAt = performance.now();
  state.game.specialInterval = setInterval(() => {
    const elapsedMs = performance.now() - gameStartAt;
    if (!state.game.specialCoinSpawned && elapsedMs >= 8000) {
      spawnCoin(40, true);
      state.game.specialCoinSpawned = true;
    }
  }, 180);

  state.game.countdownInterval = setInterval(() => {
    state.game.timer -= 1;
    gameTimer.textContent = String(Math.max(0, state.game.timer));
    triggerBump(gameTimer);
    if (state.game.timer <= 0) {
      finalizeGame();
    }
  }, 1000);
}

function launchConfetti() {
  confettiLayer.innerHTML = "";
  const colors = ["#22c55e", "#38bdf8", "#f59e0b", "#f97316", "#10b981"];

  for (let i = 0; i < 32; i += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.top = `${Math.random() * 6}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.3}s`;
    piece.style.transform = `rotate(${Math.floor(Math.random() * 180)}deg)`;
    confettiLayer.appendChild(piece);
  }
}

function startUrgencyTimer() {
  clearInterval(state.urgencyInterval);
  state.urgencySeconds = 8 * 60;

  const render = () => {
    const minutes = String(Math.floor(state.urgencySeconds / 60)).padStart(2, "0");
    const seconds = String(state.urgencySeconds % 60).padStart(2, "0");
    urgencyTimer.textContent = `${minutes}:${seconds}`;
  };

  render();
  state.urgencyInterval = setInterval(() => {
    state.urgencySeconds -= 1;
    if (state.urgencySeconds <= 0) {
      state.urgencySeconds = 0;
      clearInterval(state.urgencyInterval);
    }
    render();
  }, 1000);
}

function validateCheckoutForm(data) {
  if (!data.name || !data.phone || !data.city) {
    return "Completa nombre, telefono y ciudad.";
  }
  const digits = data.phone.replace(/\D/g, "");
  if (digits.length < 7) {
    return "Ingresa un telefono valido.";
  }
  return "";
}

function normalizeCity(city) {
  return city
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function getCityClosingLine(city) {
  const normalized = normalizeCity(city);

  if (normalized.includes("LA PAZ") || normalized.includes("EL ALTO")) {
    return "Cobertura prioritaria en La Paz y El Alto: entrega contra entrega disponible.";
  }
  if (normalized.includes("SANTA CRUZ")) {
    return "Cobertura prioritaria en Santa Cruz: confirmamos entrega contra entrega rapidamente.";
  }
  if (normalized.includes("COCHABAMBA")) {
    return "Cobertura prioritaria en Cochabamba: despacho agil con pago contra entrega.";
  }

  return "Cobertura nacional en Bolivia: coordinamos entrega contra entrega en tu ciudad.";
}

function captureOrderLead(payload) {
  const capturePayload = {
    ...payload,
    channel: "whatsapp",
    source_page: window.location.pathname + window.location.search,
  };
  const body = JSON.stringify(capturePayload);

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon("/api/order", blob);
    return;
  }

  fetch("/api/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Lead capture should never block WhatsApp redirect.
  });
}

async function submitOrder(event) {
  event.preventDefault();
  trackButtonPress("checkout_submit_whatsapp", true);

  const formData = new FormData(checkoutForm);
  const payload = {
    name: String(formData.get("name") || "").trim(),
    phone: String(formData.get("phone") || "").trim(),
    city: String(formData.get("city") || "").trim(),
    discount: state.finalDiscount,
    final_price: state.finalPrice,
    knowledge_score: state.knowledgeScore,
    quiz_answers: state.quizAnswers,
    timestamp: new Date().toISOString(),
  };

  const validationError = validateCheckoutForm(payload);
  if (validationError) {
    formMessage.textContent = validationError;
    formMessage.className = "form-message error";
    return;
  }

  submitOrderBtn.disabled = true;
  formMessage.textContent = "Redirigiendo a WhatsApp...";
  formMessage.className = "form-message";

  const messageLines = [
    "Hola, quiero pedir Berberina con mi descuento desbloqueado.",
    "",
    `Nombre: ${payload.name}`,
    `Telefono: ${payload.phone}`,
    `Ciudad: ${payload.city}`,
    `Descuento: ${payload.discount} Bs`,
    `Precio final: ${payload.final_price} Bs`,
    `Nivel de conocimiento (quiz): ${payload.knowledge_score}/100`,
    "",
    "Metodo de pago: Contra entrega",
    getCityClosingLine(payload.city),
  ];

  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(messageLines.join("\n"))}`;

  trackEvent("order_submit", {
    channel: "whatsapp",
    whatsapp_number: WHATSAPP_NUMBER,
    discount: state.finalDiscount,
    final_price: state.finalPrice,
    city: payload.city,
    knowledge_score: state.knowledgeScore,
  });
  captureOrderLead(payload);
  sendSessionEnd("whatsapp_redirect");

  window.location.href = whatsappUrl;
  submitOrderBtn.disabled = false;
}

function init() {
  initSessionTracking();
  initButtonEffects();

  heroCta.addEventListener("click", () => {
    trackButtonPress("hero_cta", true);
    trackEvent("hero_cta_click");
    trackEvent("quiz_start");
    state.quizIndex = 0;
    state.quizAnswers = [];
    state.knowledgeScore = 0;
    updateQuiz();
    showScreen("screen-quiz");
  });

  answerYes.addEventListener("click", () => {
    trackButtonPress("quiz_answer_yes");
    handleQuizAnswer("si");
  });
  answerNo.addEventListener("click", () => {
    trackButtonPress("quiz_answer_more_info");
    handleQuizAnswer("quiero_mas_info");
  });

  benefitsCta.addEventListener("click", () => {
    trackButtonPress("benefits_cta", true);
    runLoadingStep();
  });

  rewardCta.addEventListener("click", () => {
    trackButtonPress("reward_continue", true);
    showScreen("screen-urgency");
    startUrgencyTimer();
  });

  toCheckoutCta.addEventListener("click", () => {
    trackButtonPress("urgency_buy_now", true);
    trackEvent("checkout_view", { final_price: state.finalPrice, discount: state.finalDiscount });
    showScreen("screen-checkout");
  });

  checkoutForm.addEventListener("submit", submitOrder);
}

init();
