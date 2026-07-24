/** Lógica da página pública (index.html) — quadro de adoção em formato Kanban. */

let ALL_PETS = [];
let ORG_BY_ID = {};
let CURRENT_INTEREST_PET = null;
let INTEREST_MODAL_OPENED_AT = 0;

async function loadPets() {
  const board = document.getElementById("kanban-board");
  const loading = document.getElementById("board-loading");
  const errorBox = document.getElementById("board-error");

  loading.classList.remove("hidden");
  errorBox.classList.add("hidden");
  board.classList.add("hidden");

  try {
    if (window.DEMO_MODE) {
      ALL_PETS = window.DEMO_PETS.slice();
      ORG_BY_ID = { [window.DEMO_ORG.id]: window.DEMO_ORG };
    } else {
      const { data, error } = await window.sb
        .from("pets")
        // Página pública: NÃO trazer contact_email — o mural só usa o WhatsApp
        // (ver linha ~696). Buscar o e-mail aqui o colocava no payload público
        // e permitia dumpar o contato de todas as ONGs pela API. O e-mail
        // continua acessível só ao próprio abrigo, na área logada.
        .select("*, org:profiles(id, org_name, contact_whatsapp, city, state)")
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      ALL_PETS = data || [];
      ORG_BY_ID = {};
      ALL_PETS.forEach((pet) => {
        if (pet.org) ORG_BY_ID[pet.org.id] = pet.org;
      });
    }
    populateMuralFilters();
    renderBoard();
    updateMuralFiltersVisibility();
    loading.classList.add("hidden");
    board.classList.remove("hidden");
    // Rola até o alvo do hash só depois que o mural renderizou — se rolasse
    // no load do navegador, as imagens do topo ainda estavam carregando e
    // empurravam o conteúdo, fazendo o #faq (vindo de outra página) parar no
    // meio. Aqui a altura já está estável.
    if (window.location.hash.startsWith("#pet-")) {
      document.querySelector(window.location.hash)?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (window.location.hash === "#faq") {
      document.getElementById("faq")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (err) {
    console.error("[Patinhas] Erro ao carregar pets:", err);
    loading.classList.add("hidden");
    errorBox.classList.remove("hidden");
  }
}

/* ---------------- Filtros do mural ---------------- */

/** Sem nenhum pet no mural, o filtro fica COLAPSADO (só o botão "Filtrar pets",
 * com o painel fechado) — igual ao mobile, mas em qualquer tela. Com pets,
 * volta ao normal (aberto no desktop, recolhido atrás do botão no mobile). */
function updateMuralFiltersVisibility() {
  const has = ALL_PETS.length > 0;
  const wrap = document.querySelector(".mural-panel");
  const toggle = document.getElementById("mural-filters-toggle");
  const panel = document.getElementById("mural-filters");
  if (wrap) wrap.classList.toggle("filters-empty", !has);
  if (!has) {
    // colapsa: fecha o painel e marca o botão como recolhido
    if (panel) panel.classList.remove("filters-open");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }
}

/** Valores dos chips ativos de um grupo (espécie, porte ou saúde). */
function selectedChipValues(groupId) {
  return Array.from(document.querySelectorAll(`#${groupId} .filter-chip.active`)).map((c) => c.dataset.value);
}

/** Marca como ativos só os chips cujos valores estão na lista. */
function setChipValues(groupId, values) {
  document.querySelectorAll(`#${groupId} .filter-chip`).forEach((chip) => {
    const on = values.includes(chip.dataset.value);
    chip.classList.toggle("active", on);
    chip.setAttribute("aria-pressed", String(on));
  });
}

/** Estado/cidade e a lista de ONGs vêm só de onde já existe pet cadastrado —
 * evita deixar escolher uma combinação que nunca vai dar resultado. */
function populateMuralFilters() {
  const states = Array.from(
    new Set(ALL_PETS.map((pet) => (ORG_BY_ID[pet.org_id] || pet.org)?.state).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const stateSelect = document.getElementById("filter-state");
  stateSelect.innerHTML =
    `<option value="">Todos</option>` +
    states.map((uf) => `<option value="${uf}">${uf}</option>`).join("");

  // Lista de abrigos/ONGs (valor = id, rótulo = nome) — usado no filtro e no
  // link compartilhável (?ong=<id>).
  const orgs = [];
  const seen = new Set();
  ALL_PETS.forEach((pet) => {
    const o = ORG_BY_ID[pet.org_id] || pet.org;
    if (o && o.id && !seen.has(o.id)) {
      seen.add(o.id);
      orgs.push(o);
    }
  });
  orgs.sort((a, b) => (a.org_name || "").localeCompare(b.org_name || "", "pt-BR"));
  document.getElementById("filter-org").innerHTML =
    `<option value="">Todos</option>` +
    orgs.map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.org_name)}</option>`).join("");

  // Chips (espécie, porte, saúde): um clique alterna; multi-seleção.
  document.getElementById("mural-filters").addEventListener("click", (e) => {
    const chip = e.target.closest(".filter-chip");
    if (!chip) return;
    const active = chip.classList.toggle("active");
    chip.setAttribute("aria-pressed", String(active));
    applyAndRenderFilters();
  });

  const onSelectChange = () => {
    applyAndRenderFilters();
    collapseMuralFiltersOnMobile();
  };
  stateSelect.addEventListener("change", () => {
    updateMuralCityOptions();
    onSelectChange();
  });
  document.getElementById("filter-city").addEventListener("change", onSelectChange);
  document.getElementById("filter-org").addEventListener("change", onSelectChange);

  // Aplica os filtros que vierem na URL (link compartilhado) antes do 1º render.
  applyFiltersFromURL();
}

// Filtro de saúde: valor em português (chip + URL) → coluna do pet (banco, EN).
const HEALTH_COL = { vacinado: "vaccinated", vermifugado: "dewormed", castrado: "neutered" };
// Compatibilidade com links antigos que traziam os termos em inglês na URL.
const HEALTH_ALIAS = { vaccinated: "vacinado", dewormed: "vermifugado", neutered: "castrado" };

/** Reflete os filtros atuais na URL (sem recarregar) pra o link ser
 * compartilhável — ex.: um abrigo manda ?ong=<id> e o mural já abre só com
 * os pets dele. */
function updateURLFromFilters() {
  const p = new URLSearchParams();
  const sp = selectedChipValues("filter-species-chips");
  if (sp.length) p.set("especie", sp.join(","));
  const sz = selectedChipValues("filter-size-chips");
  if (sz.length) p.set("porte", sz.join(","));
  const he = selectedChipValues("filter-health-chips");
  if (he.length) p.set("saude", he.join(","));
  const st = document.getElementById("filter-state").value;
  if (st) p.set("estado", st);
  const ci = document.getElementById("filter-city").value;
  if (ci) p.set("cidade", ci);
  const og = document.getElementById("filter-org").value;
  if (og) p.set("ong", og);
  const qs = p.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
}

function applyAndRenderFilters() {
  updateURLFromFilters();
  renderBoard();
}

/** Lê os filtros da query string e aplica nos controles (só valores válidos). */
function applyFiltersFromURL() {
  const p = new URLSearchParams(location.search);
  setChipValues("filter-species-chips", (p.get("especie") || "").split(",").filter(Boolean));
  setChipValues("filter-size-chips", (p.get("porte") || "").split(",").filter(Boolean));
  setChipValues("filter-health-chips", (p.get("saude") || "").split(",").filter(Boolean).map((v) => HEALTH_ALIAS[v] || v));

  const st = p.get("estado");
  const stateSelect = document.getElementById("filter-state");
  if (st && Array.from(stateSelect.options).some((o) => o.value === st)) {
    stateSelect.value = st;
    updateMuralCityOptions();
  }
  const ci = p.get("cidade");
  const citySelect = document.getElementById("filter-city");
  if (ci && Array.from(citySelect.options).some((o) => o.value === ci)) citySelect.value = ci;

  const og = p.get("ong");
  const orgSelect = document.getElementById("filter-org");
  if (og && Array.from(orgSelect.options).some((o) => o.value === og)) orgSelect.value = og;
}

function updateMuralCityOptions() {
  const state = document.getElementById("filter-state").value;
  const citySelect = document.getElementById("filter-city");

  if (!state) {
    citySelect.innerHTML = `<option value="">Todos os estados</option>`;
    citySelect.disabled = true;
    return;
  }

  const cities = Array.from(
    new Set(
      ALL_PETS.filter((pet) => (ORG_BY_ID[pet.org_id] || pet.org)?.state === state)
        .map((pet) => (ORG_BY_ID[pet.org_id] || pet.org)?.city)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  citySelect.disabled = false;
  citySelect.innerHTML =
    `<option value="">Todas</option>` + cities.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
}

/** Mobile: mostra/esconde o painel de filtros do mural. */
function toggleMuralFilters(force) {
  const panel = document.getElementById("mural-filters");
  const toggle = document.getElementById("mural-filters-toggle");
  if (!panel || !toggle) return;
  const open = typeof force === "boolean" ? force : !panel.classList.contains("filters-open");
  panel.classList.toggle("filters-open", open);
  toggle.setAttribute("aria-expanded", String(open));
}

/** No mobile, recolhe os filtros de volta depois que a pessoa aplica um —
 * no desktop o painel fica sempre visível, então não faz nada. */
function collapseMuralFiltersOnMobile() {
  if (window.matchMedia("(max-width: 700px)").matches) toggleMuralFilters(false);
}

function clearMuralFilters() {
  setChipValues("filter-species-chips", []);
  setChipValues("filter-size-chips", []);
  setChipValues("filter-health-chips", []);
  document.getElementById("filter-state").value = "";
  document.getElementById("filter-org").value = "";
  updateMuralCityOptions();
  applyAndRenderFilters();
}

function getFilteredPets() {
  const species = selectedChipValues("filter-species-chips");
  const sizes = selectedChipValues("filter-size-chips");
  const health = selectedChipValues("filter-health-chips");
  const state = document.getElementById("filter-state").value;
  const city = document.getElementById("filter-city").value;
  const orgId = document.getElementById("filter-org").value;

  return ALL_PETS.filter((pet) => {
    // Anúncio "disponível" sem atualização há muito tempo some do mural até
    // a ONG confirmar que o pet ainda está disponível (ver isPetStale).
    if (isPetStale(pet)) return false;
    if (species.length && !species.includes(pet.species)) return false;
    if (sizes.length && !sizes.includes(pet.size)) return false;
    // O valor do chip é em PT (aparece na URL); a coluna do pet é em EN.
    if (health.some((key) => !pet[HEALTH_COL[key] || key])) return false;
    const org = ORG_BY_ID[pet.org_id] || pet.org;
    if (state && org?.state !== state) return false;
    if (city && org?.city !== city) return false;
    if (orgId && String(pet.org_id) !== orgId) return false;
    return true;
  });
}

function renderBoard() {
  const groups = groupByStatus(getFilteredPets());

  STATUS_ORDER.forEach((status) => {
    const list = document.getElementById(`column-${status}-cards`);
    const count = document.getElementById(`column-${status}-count`);
    const pets = groups[status] || [];
    count.textContent = pets.length;

    if (pets.length === 0) {
      list.innerHTML = `<div class="kanban-empty">Nenhum pet por aqui no momento.</div>`;
      return;
    }

    list.innerHTML = pets.map((pet) => petCardHtml(pet)).join("");
  });

  const statDisponivel = document.getElementById("stat-disponivel");
  const statAdotado = document.getElementById("stat-adotado");
  if (statDisponivel) statDisponivel.textContent = (groups.disponivel || []).length;
  if (statAdotado) statAdotado.textContent = (groups.adotado || []).length;

  // Mural sem nenhum resultado (vazio ou 0 após filtro) → captura de demanda,
  // mas só quando o usuário rolar até o mural (ele entrar na tela).
  const totalVisible = STATUS_ORDER.reduce((n, s) => n + (groups[s] || []).length, 0);
  armNotifyOnMuralInView(totalVisible === 0);
}

/**
 * Arma o popup só quando o mural vazio INTEIRO fica visível — as três colunas,
 * deixando claro que não há nenhum pet. Usa uma sentinela logo abaixo do board:
 * quando ela entra na tela, o fundo do mural chegou à viewport. Desarma se houver pets.
 */
let notifyMuralObserver = null;
function armNotifyOnMuralInView(isEmpty) {
  if (notifyMuralObserver) { notifyMuralObserver.disconnect(); notifyMuralObserver = null; }
  const board = document.getElementById("kanban-board");
  if (!isEmpty || !board) return;
  if (!("IntersectionObserver" in window)) { maybeShowNotifyModal(); return; }
  let sentinel = document.getElementById("notify-mural-sentinel");
  if (!sentinel) {
    sentinel = document.createElement("div");
    sentinel.id = "notify-mural-sentinel";
    sentinel.setAttribute("aria-hidden", "true");
    sentinel.style.cssText = "height:1px;width:100%;pointer-events:none;";
    board.insertAdjacentElement("afterend", sentinel);
  }
  notifyMuralObserver = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      maybeShowNotifyModal();
      if (notifyMuralObserver) { notifyMuralObserver.disconnect(); notifyMuralObserver = null; }
    }
  }, { threshold: 0 });
  notifyMuralObserver.observe(sentinel);
}

/* ---------------- Popup "avise-me quando tiver um pet" ---------------- */

/** Mostra o popup no máximo 1x a cada 7 dias por visitante (localStorage). */
function maybeShowNotifyModal() {
  const modal = document.getElementById("notify-modal");
  if (!modal || modal.classList.contains("open")) return;
  try {
    const last = localStorage.getItem("patinhas_notify_dismissed_at");
    if (last && Date.now() - Number(last) < 7 * 86400000) return;
  } catch (e) { /* localStorage indisponível → mostra mesmo assim */ }
  openNotifyModal();
}

function openNotifyModal() {
  const modal = document.getElementById("notify-modal");
  if (!modal) return;
  const uf = document.getElementById("notify-uf");
  if (uf && !uf.options.length && typeof populateStateSelect === "function") {
    populateStateSelect(uf, "Qualquer estado");
  }
  document.getElementById("notify-form").reset();
  document.getElementById("notify-form").classList.remove("hidden");
  document.getElementById("notify-error").classList.remove("visible");
  document.getElementById("notify-success").classList.remove("visible");
  modal.classList.add("open");
}

/** Fechar (X ou clique fora) registra a dispensa → respeita os 7 dias. */
function closeNotifyModal() {
  const modal = document.getElementById("notify-modal");
  if (modal) modal.classList.remove("open");
  try { localStorage.setItem("patinhas_notify_dismissed_at", String(Date.now())); } catch (e) {}
}

function showNotifySuccess() {
  document.getElementById("notify-form").classList.add("hidden");
  const s = document.getElementById("notify-success");
  s.textContent = "Prontinho! A gente te avisa 💚";
  s.classList.add("visible");
  try { localStorage.setItem("patinhas_notify_dismissed_at", String(Date.now())); } catch (e) {}
  setTimeout(() => document.getElementById("notify-modal").classList.remove("open"), 2600);
}

async function submitNotify(event) {
  event.preventDefault();
  const email = document.getElementById("notify-email").value.trim();
  const consent = document.getElementById("notify-consent");
  const errorBox = document.getElementById("notify-error");
  errorBox.classList.remove("visible");

  if (!email) {
    errorBox.textContent = "Digite seu e-mail para receber o aviso.";
    errorBox.classList.add("visible");
    return;
  }
  if (!consent || !consent.checked) {
    errorBox.textContent = "Marque o consentimento para a gente poder te avisar.";
    errorBox.classList.add("visible");
    return;
  }

  // Honeypot: bot preencheu o campo oculto → finge sucesso, não salva.
  const hp = document.getElementById("notify-hp");
  if (hp && hp.value.trim() !== "") { showNotifySuccess(); return; }

  const submitBtn = document.getElementById("notify-submit-btn");
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="paw-spinner">🐾</span> Enviando...`;
  try {
    if (!window.DEMO_MODE) {
      const ufEl = document.getElementById("notify-uf");
      const espRadio = document.querySelector('input[name="notify-especie-r"]:checked');
      const porteRadio = document.querySelector('input[name="notify-porte-r"]:checked');
      const payload = {
        email,
        uf: ufEl ? (ufEl.value || null) : null,
        especie: espRadio ? (espRadio.value || null) : null,
        porte: porteRadio ? (porteRadio.value || null) : null,
        consentimento_em: new Date().toISOString(),
      };
      const { error } = await window.sb.from("notificacoes_interesse").insert([payload]);
      if (error) throw error;
    }
    showNotifySuccess();
  } catch (err) {
    console.error("[Patinhas] Erro ao salvar notificação de interesse:", err);
    errorBox.textContent = "Não foi possível salvar agora. Tente novamente em instantes.";
    errorBox.classList.add("visible");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = "Me avise quando chegar 🐾";
  }
}

/** Pet recém-cadastrado (últimos 10 dias) — ganha o selinho "novo". */
function isNewPet(pet) {
  if (!pet.created_at) return false;
  return Date.now() - new Date(pet.created_at).getTime() < 10 * 86400000;
}

function petCardHtml(pet) {
  const org = ORG_BY_ID[pet.org_id] || pet.org || null;
  // Foto renderizada como <img> (não background-image) para ganhar
  // lazy-loading e decodificação assíncrona nativos do navegador — essencial
  // para a performance mobile quando há muitos pets no mural.
  const photoSrc = safeHttpUrl(pet.photo_url);
  // Card adotado com foto da família → mostra a família com o pet (prova social).
  const familySrc = pet.status === "adotado" ? safeHttpUrl(pet.family_photo_url) : "";
  const mainPhotoSrc = familySrc || photoSrc;
  const isNew = pet.status === "disponivel" && isNewPet(pet);
  const photoAlt = familySrc
    ? `A nova família de ${escapeHtml(pet.name)}`
    : `Foto de ${escapeHtml(pet.name)}, ${escapeHtml(speciesLabel(pet.species).replace(/[^\p{L}\s]/gu, "").trim().toLowerCase())} para adoção`;
  const photoImg = mainPhotoSrc
    ? `<img class="pet-card-photo-img" src="${escapeHtml(mainPhotoSrc)}" alt="${photoAlt}" loading="lazy" decoding="async" />`
    : "";
  const interestBtn =
    pet.status === "disponivel"
      ? `<button class="btn btn-primary btn-cta btn-block" onclick="openInterestModal('${pet.id}')">Quero adotar! 🐾</button>`
      : "";
  const metaParts = [speciesLabel(pet.species), pet.size, ageLabelWithRange(pet.age_label)].filter(Boolean);
  // No site público, a descrição só aparece para pets ainda disponíveis —
  // uma vez em processo ou adotado, o texto de "procurando um lar" perde o
  // sentido. Sempre mostra algo (ver petDescriptionOrFallback) mesmo que a
  // ONG não tenha marcado nenhuma característica.
  const showDescription = pet.status === "disponivel";
  // Compartilhar só faz sentido enquanto o pet está disponível para adoção —
  // em processo ou já adotado, não há para onde encaminhar interessados.
  const shareBtn =
    pet.status === "disponivel"
      // O nome vai num data-attribute, NÃO dentro da string do onclick: o
      // navegador decodifica as entidades antes de compilar o handler, então
      // escapeHtml não protege ali — um nome de pet com aspas escaparia da
      // string e viraria código executável para todo visitante. Em atributo
      // comum, escapeHtml basta.
      ? `<button type="button" class="pet-card-share-btn" title="Compartilhar" data-pet-name="${escapeHtml(pet.name)}" onclick="sharePet(this, '${pet.id}')">🔗</button>`
      : "";

  return `
    <article class="pet-card" id="pet-${pet.id}">
      <div class="pet-card-photo">
        ${photoImg}
        ${isNew ? `<span class="pet-card-new-badge">✨ novo</span>` : ""}
        ${shareBtn}
        ${org ? `<span class="pet-card-org-pin">📍 ${escapeHtml(org.org_name)}</span>` : ""}
        ${familySrc ? `<span class="pet-card-family-cap">💚 Em seu novo lar</span>` : ""}
      </div>
      <div class="pet-card-body">
        <div class="pet-card-top">
          <h3 class="pet-card-name">${escapeHtml(pet.name)} ${genderSymbolHtml(pet.gender, pet.name)}</h3>
        </div>
        <p class="pet-card-meta">${metaParts.map(escapeHtml).join(" · ")}</p>
        ${petHealthBadgesHtml(pet)}
        ${showDescription ? `<p class="pet-card-desc">${escapeHtml(petDescriptionOrFallback(pet))}</p>` : ""}
        <div class="pet-card-actions">${interestBtn}</div>
      </div>
    </article>
  `;
}

/** Compartilha o link direto do pet — usa a Web Share API nativa quando
 * disponível (mobile), senão copia o link e avisa no próprio botão. */
async function sharePet(button, petId) {
  const petName = button.dataset.petName || "esse pet";
  const url = `${window.location.origin}${window.location.pathname}#pet-${petId}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: `Conheça ${petName} no Patinhas 🐾`, url });
    } catch (err) {
      // usuário cancelou o compartilhamento — não é um erro real
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    const original = button.textContent;
    button.textContent = "✅";
    button.disabled = true;
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1500);
  } catch (err) {
    console.error("[Patinhas] Não foi possível copiar o link:", err);
  }
}

/* ---------------- Modal "Tenho interesse" ---------------- */

function openInterestModal(petId) {
  const pet = ALL_PETS.find((p) => p.id === petId);
  if (!pet) return;
  CURRENT_INTEREST_PET = pet;

  const org = ORG_BY_ID[pet.org_id] || pet.org || null;

  document.getElementById("interest-pet-name").textContent = pet.name;
  // Horário de abertura — usado no anti-spam (envio instantâneo = bot).
  INTEREST_MODAL_OPENED_AT = Date.now();
  const contextPhoto = document.getElementById("interest-pet-photo");
  const ctxPhotoUrl = safeHttpUrl(pet.photo_url);
  contextPhoto.style.backgroundImage = ctxPhotoUrl ? `url('${ctxPhotoUrl}')` : "";
  contextPhoto.style.backgroundSize = pet.photo_url ? "cover" : "";
  contextPhoto.classList.toggle("interest-pet-context-photo--empty", !pet.photo_url);

  document.getElementById("interest-pet-headline").innerHTML =
    `${escapeHtml(pet.name)} ${genderSymbolHtml(pet.gender, pet.name)}`;
  const metaParts = [speciesLabel(pet.species), pet.size, ageLabelWithRange(pet.age_label)].filter(Boolean);
  document.getElementById("interest-pet-meta").textContent = metaParts.join(" · ");
  document.getElementById("interest-pet-badges").innerHTML =
    petHealthBadgesHtml(pet);
  document.getElementById("interest-pet-description").textContent = petDescriptionOrFallback(pet);
  const orgEl = document.getElementById("interest-pet-org");
  orgEl.textContent = org ? `📍 ${org.org_name}` : "";
  orgEl.classList.toggle("hidden", !org);
  document.getElementById("interest-form").reset();
  document.getElementById("interest-error").classList.remove("visible");
  document.getElementById("interest-success").classList.remove("visible");
  document.getElementById("interest-form").classList.remove("hidden");
  document.getElementById("interest-whatsapp-cta").classList.add("hidden");
  document.getElementById("interest-close-confirm").classList.add("hidden");

  // Abrigo com formulário próprio: mostra primeiro a escolha entre os dois
  // caminhos, em vez de ir direto pro formulário do Patinhas.
  const orgFormUrl = safeHttpUrl(pet.adoption_form_url);
  if (orgFormUrl) {
    document.getElementById("interest-org-form-link").href = orgFormUrl;
    document.getElementById("interest-choice-step").classList.remove("hidden");
    document.getElementById("interest-form-step").classList.add("hidden");
  } else {
    document.getElementById("interest-choice-step").classList.add("hidden");
    document.getElementById("interest-form-step").classList.remove("hidden");
  }

  document.getElementById("interest-modal").classList.add("open");
}

/** CTA principal do passo de escolha — o Patinhas continua sendo o fluxo
 * principal, então "ir pro formulário do abrigo" nunca é o único caminho. */
function showInterestFormStep() {
  document.getElementById("interest-choice-step").classList.add("hidden");
  document.getElementById("interest-form-step").classList.remove("hidden");
}

/** Só confirma a saída se a pessoa já preencheu alguma coisa — evitar
 * perguntar à toa quando não há nada a perder. */
function attemptCloseInterestModal() {
  const hasInput = ["interest-name", "interest-phone", "interest-email", "interest-message"].some(
    (id) => document.getElementById(id).value.trim()
  );
  const alreadySubmitted = document.getElementById("interest-success").classList.contains("visible");
  if (!hasInput || alreadySubmitted) {
    closeInterestModal();
    return;
  }
  document.getElementById("interest-close-confirm").classList.remove("hidden");
}

function cancelCloseInterestModal() {
  document.getElementById("interest-close-confirm").classList.add("hidden");
}

function closeInterestModal() {
  document.getElementById("interest-modal").classList.remove("open");
  CURRENT_INTEREST_PET = null;
}

/** Mostra o passo de sucesso do formulário (sem inserir nada). */
function showInterestSuccess() {
  document.getElementById("interest-form").classList.add("hidden");
  const box = document.getElementById("interest-success");
  box.textContent = "Interesse enviado! O abrigo vai entrar em contato em breve. 🎉";
  box.classList.add("visible");
}

/* Cooldown anti-spam por pet, guardado no navegador: no máx. 1 envio a cada 30s
   por pet e 6 no total por hora. Não substitui o trigger do banco — só evita
   floods acidentais e reduz spam casual. */
const INTEREST_SEND_KEY = "patinhas_interest_sends";
function readInterestSends() {
  try {
    const arr = JSON.parse(localStorage.getItem(INTEREST_SEND_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}
function interestRateLimited(petId) {
  const now = Date.now();
  const sends = readInterestSends().filter((s) => now - s.t < 3600000);
  const samePetRecent = sends.filter((s) => s.pet === petId && now - s.t < 30000);
  return samePetRecent.length > 0 || sends.length >= 6;
}
function recordInterestSend(petId) {
  const now = Date.now();
  const sends = readInterestSends().filter((s) => now - s.t < 3600000);
  sends.push({ pet: petId, t: now });
  try {
    localStorage.setItem(INTEREST_SEND_KEY, JSON.stringify(sends));
  } catch (_) {}
}

async function submitInterest(event) {
  event.preventDefault();
  if (!CURRENT_INTEREST_PET) return;

  const name = document.getElementById("interest-name").value.trim();
  const email = document.getElementById("interest-email").value.trim();
  const phone = document.getElementById("interest-phone").value.trim();
  const message = document.getElementById("interest-message").value.trim();
  const errorBox = document.getElementById("interest-error");
  errorBox.classList.remove("visible");

  if (!name || (!email && !phone)) {
    errorBox.textContent = "Preencha seu nome e pelo menos um contato (telefone ou e-mail).";
    errorBox.classList.add("visible");
    return;
  }

  // Consentimento LGPD + maioridade (obrigatórios).
  const consent = document.getElementById("interest-consent-check");
  const age = document.getElementById("interest-age-check");
  if (!consent || !consent.checked) {
    errorBox.textContent = "Para enviar, é preciso concordar com a Política de Privacidade.";
    errorBox.classList.add("visible");
    return;
  }
  if (!age || !age.checked) {
    errorBox.textContent = "É preciso confirmar que você é maior de 18 anos.";
    errorBox.classList.add("visible");
    return;
  }

  // --- Anti-spam (camadas leves no cliente; a proteção real é o trigger no
  //     banco). Em todos os casos de bot, fingimos sucesso para não dar pista. ---
  const honeypot = document.getElementById("interest-hp");
  const looksLikeBot =
    (honeypot && honeypot.value.trim() !== "") || // honeypot preenchido
    Date.now() - INTEREST_MODAL_OPENED_AT < 1500;  // enviado rápido demais
  if (looksLikeBot) {
    showInterestSuccess();
    return;
  }
  if (interestRateLimited(CURRENT_INTEREST_PET.id)) {
    errorBox.textContent = "Você já enviou interesse agora há pouco. Aguarde um instante antes de tentar de novo.";
    errorBox.classList.add("visible");
    return;
  }

  const submitBtn = document.getElementById("interest-submit-btn");
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="paw-spinner">🐾</span> Enviando...`;

  try {
    if (!window.DEMO_MODE) {
      const { error } = await window.sb.from("interests").insert([
        {
          pet_id: CURRENT_INTEREST_PET.id,
          name,
          email: email || null,
          phone: phone || null,
          message: message || null,
        },
      ]);
      if (error) throw error;
    }

    document.getElementById("interest-form").classList.add("hidden");
    const successBox = document.getElementById("interest-success");
    successBox.textContent = window.DEMO_MODE
      ? "Modo demonstração: seu interesse não foi salvo de verdade, mas é assim que vai funcionar! 🎉"
      : "Interesse enviado! O abrigo vai entrar em contato em breve. 🎉";
    successBox.classList.add("visible");

    const org = ORG_BY_ID[CURRENT_INTEREST_PET.org_id];
    if (org && org.contact_whatsapp) {
      const link = whatsappLink(
        org.contact_whatsapp,
        `Olá! Tenho interesse em adotar ${CURRENT_INTEREST_PET.name} 🐾`
      );
      const cta = document.getElementById("interest-whatsapp-cta");
      cta.href = link;
      cta.classList.remove("hidden");
    }
    recordInterestSend(CURRENT_INTEREST_PET.id);
  } catch (err) {
    console.error("[Patinhas] Erro ao registrar interesse:", err);
    errorBox.textContent = "Não foi possível enviar agora. Tente novamente em instantes.";
    errorBox.classList.add("visible");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Enviar";
  }
}

/* ---------------- Efeito de tilt nas fotos do hero ---------------- */

/** Leve inclinação 3D que segue o mouse dentro de cada foto do hero — só
 * decorativo, some suavemente quando o mouse sai. */
function setupHeroTilt() {
  const tiles = document.querySelectorAll(".hero-tile");
  tiles.forEach((tile) => {
    tile.addEventListener("mousemove", (event) => {
      const rect = tile.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      const rotateY = x * 16;
      const rotateX = y * -16;
      tile.classList.add("tilting");
      tile.style.transition = "none";
      tile.style.transform = `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.03, 1.03, 1.03)`;
    });
    tile.addEventListener("mouseleave", () => {
      tile.classList.remove("tilting");
      tile.style.transition = "";
      tile.style.transform = "";
    });
  });
}

/* ---------------- Carrossel mobile (indicador de bolinhas) ---------------- */

function setupKanbanDots() {
  const board = document.getElementById("kanban-board");
  const dots = Array.from(document.querySelectorAll(".kanban-dot"));
  if (!board || !dots.length) return;

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const target = document.getElementById(dot.dataset.target);
      if (target) target.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    });
  });

  setupDragToScroll(board);

  const columns = STATUS_ORDER.map((status) => document.getElementById(`kanban-column-${status}`)).filter(Boolean);
  if (!columns.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.5) return;
        const idx = columns.indexOf(entry.target);
        dots.forEach((dot, i) => dot.classList.toggle("active", i === idx));
      });
    },
    { root: board, threshold: [0.5] }
  );
  columns.forEach((col) => observer.observe(col));
}

// Arrastar as colunas com o cursor (clicar-e-segurar), além do scroll normal.
// Só faz sentido quando o board vira carrossel horizontal (mobile/telas
// estreitas); em telas largas ele é um grid e scrollWidth == clientWidth,
// então o arrasto simplesmente não tem para onde mover.
function setupDragToScroll(board) {
  let isDown = false;
  let startX = 0;
  let startScroll = 0;
  let moved = false;

  board.addEventListener("pointerdown", (e) => {
    // Todo novo toque começa "limpo": zera o flag de arrasto mesmo quando o
    // alvo é um botão/link (senão um arrasto anterior deixaria `moved=true` e
    // engoliria o próximo clique num card).
    moved = false;
    // Cliques em botões/links dentro dos cards devem funcionar normalmente,
    // sem serem interpretados como arrasto do board.
    if (e.target.closest("button, a")) return;
    isDown = true;
    startX = e.clientX;
    startScroll = board.scrollLeft;
  });

  board.addEventListener("pointermove", (e) => {
    if (!isDown) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 4) {
      moved = true;
      board.classList.add("dragging");
      board.setPointerCapture(e.pointerId);
    }
    if (moved) board.scrollLeft = startScroll - dx;
  });

  const end = () => {
    isDown = false;
    board.classList.remove("dragging");
  };
  board.addEventListener("pointerup", end);
  board.addEventListener("pointercancel", end);

  // Se houve arrasto, cancela o clique que dispararia logo em seguida
  // (evita abrir um modal sem querer ao terminar de arrastar sobre um card).
  board.addEventListener(
    "click",
    (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    },
    true
  );
}

document.addEventListener("DOMContentLoaded", () => {
  loadPets();
  document.getElementById("interest-form").addEventListener("submit", submitInterest);
  document.getElementById("notify-form").addEventListener("submit", submitNotify);
  attachPhoneMask(document.getElementById("interest-phone"));
  setupKanbanDots();
  setupBackToTop();
  setupHeroTilt();
  setupNotifyBursts();
  setupFamilyHeart();
  if (typeof pawMarauder === "function") pawMarauder();
});

/** Camada fixa onde os emojis "voam"; criada sob demanda e reaproveitada. */
function getBurstLayer() {
  let layer = document.querySelector(".notify-burst-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "notify-burst-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
  }
  return layer;
}

/** Solta emojis subindo a partir de um elemento (charme rápido no hover). */
function emojiBurstFrom(el, emojis) {
  const r = el.getBoundingClientRect();
  const layer = getBurstLayer();
  emojis.forEach((emo, i) => {
    const s = document.createElement("span");
    s.className = "notify-burst";
    s.textContent = emo;
    s.style.left = (r.left + r.width * (0.2 + Math.random() * 0.6)) + "px";
    s.style.top = (r.top + 8) + "px";
    s.style.setProperty("--dx", ((Math.random() - 0.5) * 28).toFixed(0) + "px");
    s.style.setProperty("--delay", (i * 85) + "ms");
    layer.appendChild(s);
    setTimeout(() => s.remove(), 1100);
  });
}

/** Bichinhos "voando" ao passar o mouse nos destaques do popup. */
function setupNotifyBursts() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelectorAll(".notify-explore [data-burst]").forEach((btn) => {
    let last = 0;
    btn.addEventListener("mouseenter", () => {
      const now = Date.now();
      if (now - last < 700) return;
      last = now;
      emojiBurstFrom(btn, (btn.getAttribute("data-burst") || "🐾").split(","));
    });
  });
}

/** Coração ao passar o mouse em "famílias formadas" — só quando já há famílias. */
function setupFamilyHeart() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const span = document.getElementById("stat-adotado");
  const pill = span && span.closest(".stat-pill");
  if (!pill) return;
  let last = 0;
  pill.addEventListener("mouseenter", () => {
    const n = parseInt((span.textContent || "0").replace(/\D/g, ""), 10) || 0;
    if (n <= 0) return;
    const now = Date.now();
    if (now - last < 500) return;
    last = now;
    emojiBurstFrom(pill, ["💚", "❤️", "💚"]);
  });
}
