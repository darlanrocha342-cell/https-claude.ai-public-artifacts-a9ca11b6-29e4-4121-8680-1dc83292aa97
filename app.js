const STORAGE_KEY = "agenda.appointments";

const CATEGORY_LABELS = {
  pessoal: "Pessoal",
  trabalho: "Trabalho",
  saude: "Saúde",
  estudo: "Estudo",
  outro: "Outro",
};

const form = document.getElementById("appointment-form");
const idInput = document.getElementById("appointment-id");
const titleInput = document.getElementById("title");
const dateInput = document.getElementById("date");
const timeInput = document.getElementById("time");
const locationInput = document.getElementById("location");
const notesInput = document.getElementById("notes");
const categoryInput = document.getElementById("category");
const formTitle = document.getElementById("form-title");
const submitBtn = document.getElementById("submit-btn");
const cancelEditBtn = document.getElementById("cancel-edit-btn");
const list = document.getElementById("appointment-list");
const emptyState = document.getElementById("empty-state");
const searchInput = document.getElementById("search-input");
const filterSelect = document.getElementById("filter-select");
const toast = document.getElementById("toast");

function loadAppointments() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveAppointments(appointments) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appointments));
}

let appointments = loadAppointments();
let toastTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2200);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getDateTime(appt) {
  return new Date(`${appt.date}T${appt.time || "00:00"}`);
}

function formatDate(dateStr) {
  const [year, month, day] = dateStr.split("-");
  return `${day}/${month}/${year}`;
}

function isSameDay(dateStr) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return dateStr === todayStr;
}

function resetForm() {
  form.reset();
  idInput.value = "";
  formTitle.textContent = "Novo Compromisso";
  submitBtn.textContent = "Adicionar Compromisso";
  cancelEditBtn.classList.add("hidden");
}

function startEdit(id) {
  const appt = appointments.find((a) => a.id === id);
  if (!appt) return;
  idInput.value = appt.id;
  titleInput.value = appt.title;
  dateInput.value = appt.date;
  timeInput.value = appt.time;
  locationInput.value = appt.location || "";
  notesInput.value = appt.notes || "";
  categoryInput.value = appt.category || "outro";
  formTitle.textContent = "Editar Compromisso";
  submitBtn.textContent = "Salvar Alterações";
  cancelEditBtn.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function deleteAppointment(id) {
  const appt = appointments.find((a) => a.id === id);
  if (!appt) return;
  if (!confirm(`Excluir o compromisso "${appt.title}"?`)) return;
  appointments = appointments.filter((a) => a.id !== id);
  saveAppointments(appointments);
  if (idInput.value === id) resetForm();
  render();
  showToast("Compromisso excluído.");
}

function applyFiltersAndSort() {
  const query = searchInput.value.trim().toLowerCase();
  const filter = filterSelect.value;
  const now = new Date();

  let result = appointments.filter((appt) => {
    if (query) {
      const haystack = `${appt.title} ${appt.location || ""} ${appt.notes || ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    const dt = getDateTime(appt);
    if (filter === "upcoming" && dt < now) return false;
    if (filter === "past" && dt >= now) return false;
    if (filter === "today" && !isSameDay(appt.date)) return false;
    return true;
  });

  result.sort((a, b) => getDateTime(a) - getDateTime(b));
  return result;
}

function render() {
  const items = applyFiltersAndSort();
  list.innerHTML = "";

  if (items.length === 0) {
    emptyState.classList.remove("hidden");
  } else {
    emptyState.classList.add("hidden");
  }

  const now = new Date();

  items.forEach((appt) => {
    const li = document.createElement("li");
    const dt = getDateTime(appt);
    li.className = "appointment-card";
    if (dt < now && !isSameDay(appt.date)) li.classList.add("past");
    if (isSameDay(appt.date)) li.classList.add("today");

    const main = document.createElement("div");
    main.className = "appointment-main";

    const titleEl = document.createElement("p");
    titleEl.className = "appointment-title";
    titleEl.textContent = appt.title;

    const meta = document.createElement("div");
    meta.className = "appointment-meta";
    const metaParts = [`📅 ${formatDate(appt.date)}`, `🕐 ${appt.time}`];
    if (appt.location) metaParts.push(`📍 ${appt.location}`);
    metaParts.forEach((text) => {
      const span = document.createElement("span");
      span.textContent = text;
      meta.appendChild(span);
    });

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = CATEGORY_LABELS[appt.category] || "Outro";

    main.appendChild(titleEl);
    main.appendChild(meta);
    main.appendChild(badge);

    if (appt.notes) {
      const notesEl = document.createElement("p");
      notesEl.className = "appointment-notes";
      notesEl.textContent = appt.notes;
      main.appendChild(notesEl);
    }

    const actions = document.createElement("div");
    actions.className = "appointment-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "icon-btn";
    editBtn.textContent = "Editar";
    editBtn.addEventListener("click", () => startEdit(appt.id));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "icon-btn delete";
    deleteBtn.textContent = "Excluir";
    deleteBtn.addEventListener("click", () => deleteAppointment(appt.id));

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(main);
    li.appendChild(actions);
    list.appendChild(li);
  });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const data = {
    title: titleInput.value.trim(),
    date: dateInput.value,
    time: timeInput.value,
    location: locationInput.value.trim(),
    notes: notesInput.value.trim(),
    category: categoryInput.value,
  };

  if (!data.title || !data.date || !data.time) return;

  if (idInput.value) {
    const idx = appointments.findIndex((a) => a.id === idInput.value);
    if (idx !== -1) {
      appointments[idx] = { ...appointments[idx], ...data };
      showToast("Compromisso atualizado.");
    }
  } else {
    appointments.push({ id: generateId(), ...data });
    showToast("Compromisso adicionado.");
  }

  saveAppointments(appointments);
  resetForm();
  render();
});

cancelEditBtn.addEventListener("click", resetForm);
searchInput.addEventListener("input", render);
filterSelect.addEventListener("change", render);

render();
