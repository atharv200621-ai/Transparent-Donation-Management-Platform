"use strict";

/* =========================================================
   TRUSTDONATE FRONTEND  (talks to the Node/Express backend)
   ========================================================= */

const TOKEN_KEY = "trustDonateToken";
const USER_KEY = "trustDonateCurrentUser";
const THEME_KEY = "trustDonateTheme";

const state = {
    donorDonations: [],
    selectedOrganization: "",
    latestDonationId: "",
    donating: false
};

const $ = (id) => document.getElementById(id);

/* =========================================================
   API HELPER
   ========================================================= */

async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json" };
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.Authorization = "Bearer " + token;

    let res;
    try {
        res = await fetch("/api" + path, {
            method: options.method || "GET",
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined
        });
    } catch (e) {
        throw new Error("Cannot reach the server. Make sure it is running.");
    }

    let data = {};
    try { data = await res.json(); } catch (e) { /* no body */ }

    if (!res.ok) {
        const err = new Error(data.error || "Request failed (" + res.status + ")");
        err.status = res.status;
        if (res.status === 401 && token && !options.noLogout) {
            clearSession();
            updateNavigation();
        }
        throw err;
    }
    return data;
}

/* =========================================================
   SESSION
   ========================================================= */

function currentUser() {
    try {
        return JSON.parse(localStorage.getItem(USER_KEY));
    } catch (e) {
        return null;
    }
}

function saveSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}

async function validateSession() {
    if (!localStorage.getItem(TOKEN_KEY)) {
        clearSession();
        return;
    }
    try {
        const { user } = await api("/auth/me", { noLogout: true });
        localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) {
        if (e.status === 401) clearSession();
    }
}

/* =========================================================
   UTILITIES
   ========================================================= */

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatCurrency(amount) {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0
    }).format(Number(amount) || 0);
}

function formatDate(date) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function showMessage(id, message, type = "info") {
    const el = $(id);
    if (!el) return;
    el.innerHTML = `<div class="alert alert-${type}">${escapeHTML(message)}</div>`;
}

function clearMessage(id) {
    const el = $(id);
    if (el) el.innerHTML = "";
}

function toast(message) {
    const el = $("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

function setBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
        button.dataset.originalText = button.innerHTML;
        button.disabled = true;
        button.textContent = busyText || "Please wait...";
    } else {
        button.disabled = false;
        if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
    }
}

function handleDashboardError(e) {
    if (e.status === 401 || e.status === 403) {
        clearSession();
        updateNavigation();
        navigate("login");
        toast("Please login again.");
    } else {
        toast(e.message);
    }
}

/* =========================================================
   NAVIGATION
   ========================================================= */

const VALID_PAGES = [
    "home", "login", "register", "donate", "track", "about",
    "donor-dashboard", "organization-dashboard", "ca-dashboard"
];

function dashboardFor(role) {
    return role === "donor"
        ? "donor-dashboard"
        : role === "organization"
            ? "organization-dashboard"
            : "ca-dashboard";
}

function navigate(page) {
    if (!VALID_PAGES.includes(page)) page = "home";

    const user = currentUser();

    if (page === "donor-dashboard" && (!user || user.role !== "donor")) {
        page = "login";
        toast("Please login as a donor first.");
    }
    if (page === "organization-dashboard" && (!user || user.role !== "organization")) {
        page = "login";
        toast("Please login as an organization first.");
    }
    if (page === "ca-dashboard" && (!user || user.role !== "ca")) {
        page = "login";
        toast("Please login as a CA / Accountant first.");
    }

    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    const target = $("page-" + page);
    if (target) target.classList.add("active");

    document.querySelectorAll("[data-page]").forEach((el) => el.classList.remove("active"));
    document.querySelectorAll(`[data-page="${page}"]`).forEach((el) => el.classList.add("active"));

    if (location.hash.replace("#", "") !== page) {
        history.replaceState(null, "", "#" + page);
    }

    $("navLinks")?.classList.remove("open");
    window.scrollTo({ top: 0, behavior: "smooth" });
    updateNavigation();

    if (page === "donate") {
        prefillDonor();
        loadOrganizations();
    }
    if (page === "donor-dashboard") renderDonorDashboard();
    if (page === "organization-dashboard") renderOrganizationDashboard();
    if (page === "ca-dashboard") renderCADashboard();
}

function updateNavigation() {
    const nav = $("navLinks");
    if (!nav) return;

    const user = currentUser();
    let dashboardLink = "";
    if (user) {
        const dash = dashboardFor(user.role);
        dashboardLink = `<a href="#${dash}" data-page="${dash}">Dashboard</a>`;
    }

    nav.innerHTML = `
        <a href="#home" data-page="home">Home</a>
        <a href="#donate" data-page="donate">Donate</a>
        <a href="#track" data-page="track">Track</a>
        <a href="#about" data-page="about">About</a>
        ${dashboardLink}
        ${user
            ? `<button id="logoutBtn">Logout</button>`
            : `<a href="#login" data-page="login">Login</a>`}
    `;

    nav.querySelectorAll("[data-page]").forEach((link) => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            navigate(link.dataset.page);
        });
    });

    const logoutBtn = $("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", logout);

    const active = (location.hash || "#home").replace("#", "");
    nav.querySelectorAll(`[data-page="${active}"]`).forEach((el) => el.classList.add("active"));
}

function logout() {
    clearSession();
    updateNavigation();
    navigate("home");
    toast("You have been logged out.");
}

/* =========================================================
   LOGIN
   ========================================================= */

function setupLogin() {
    $("loginForm").addEventListener("submit", async (e) => {
        e.preventDefault();

        const email = $("loginEmail").value.trim().toLowerCase();
        const password = $("loginPassword").value;
        const role = $("loginRole").value;
        const button = e.target.querySelector('button[type="submit"]');

        clearMessage("loginMessage");
        setBusy(button, true, "Logging in...");

        try {
            const { token, user } = await api("/auth/login", {
                method: "POST",
                body: { email, password, role },
                noLogout: true
            });
            saveSession(token, user);
            showMessage("loginMessage", "Login successful.", "success");
            e.target.reset();
            setTimeout(() => {
                clearMessage("loginMessage");
                navigate(dashboardFor(user.role));
            }, 500);
        } catch (err) {
            showMessage("loginMessage", err.message, "error");
        } finally {
            setBusy(button, false);
        }
    });

    $("togglePassword").addEventListener("click", () => {
        const input = $("loginPassword");
        const button = $("togglePassword");
        if (input.type === "password") {
            input.type = "text";
            button.textContent = "Hide";
        } else {
            input.type = "password";
            button.textContent = "Show";
        }
    });
}

/* =========================================================
   REGISTRATION
   ========================================================= */

function setupRegistration() {
    const role = $("regRole");
    const orgFields = $("organizationFields");
    const caFields = $("caFields");

    const toggleFields = () => {
        orgFields.classList.toggle("hidden", role.value !== "organization");
        if (caFields) caFields.classList.toggle("hidden", role.value !== "ca");
    };
    role.addEventListener("change", toggleFields);
    toggleFields();

    $("registerForm").addEventListener("submit", async (e) => {
        e.preventDefault();

        const button = e.target.querySelector('button[type="submit"]');
        const body = {
            name: $("regName").value.trim(),
            phone: $("regPhone").value.trim(),
            email: $("regEmail").value.trim().toLowerCase(),
            password: $("regPassword").value,
            role: role.value
        };

        if (body.role === "organization") {
            body.organizationName = $("orgName").value.trim();
            body.registrationNumber = $("registrationNumber").value.trim();
        }
        if (body.role === "ca") {
            body.caMembership = $("caMembership") ? $("caMembership").value.trim() : "";
        }

        clearMessage("registerMessage");
        setBusy(button, true, "Creating account...");

        try {
            const result = await api("/auth/register", { method: "POST", body, noLogout: true });
            showMessage(
                "registerMessage",
                result.message + (result.approved ? " Redirecting to login..." : ""),
                "success"
            );
            e.target.reset();
            toggleFields();
            if (result.approved) {
                setTimeout(() => {
                    clearMessage("registerMessage");
                    navigate("login");
                }, 1200);
            }
        } catch (err) {
            showMessage("registerMessage", err.message, "error");
        } finally {
            setBusy(button, false);
        }
    });
}

/* =========================================================
   ORGANIZATION LIST (built-in cards + registered NGOs)
   ========================================================= */

async function loadOrganizations() {
    const container = document.querySelector(".org-cards");
    if (!container) return;

    try {
        const { organizations } = await api("/organizations", { noLogout: true });
        const existing = new Set(
            [...container.querySelectorAll(".org-card")].map((c) => c.dataset.org)
        );

        organizations.forEach((org) => {
            if (existing.has(org.name)) return;

            const card = document.createElement("div");
            card.className = "org-card";
            card.dataset.org = org.name;

            const icon = document.createElement("div");
            icon.className = "org-icon";
            icon.textContent = "🏛️";

            const info = document.createElement("div");
            info.className = "org-info";
            const strong = document.createElement("strong");
            strong.textContent = org.name;
            const small = document.createElement("small");
            small.textContent = "Verified organization";
            info.append(strong, small);

            const check = document.createElement("div");
            check.className = "org-check";
            check.textContent = "✓";

            card.append(icon, info, check);
            container.appendChild(card);

            if (state.selectedOrganization === org.name) card.classList.add("selected");
        });
    } catch (e) {
        /* the built-in cards still work */
    }
}

/* =========================================================
   DONATION  (Razorpay)
   ========================================================= */

function prefillDonor() {
    const user = currentUser();
    const nameInput = $("donorName");
    const emailInput = $("donorEmail");

    if (user && user.role === "donor") {
        nameInput.value = user.name;
        emailInput.value = user.email;
        emailInput.readOnly = true;
    } else {
        emailInput.readOnly = false;
    }
}

function setupDonation() {
    prefillDonor();

    /* Organization selection (works for cards added later too) */
    document.querySelector(".org-cards").addEventListener("click", (e) => {
        const card = e.target.closest(".org-card");
        if (!card) return;

        document.querySelectorAll(".org-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        state.selectedOrganization = card.dataset.org;
        $("organization").value = state.selectedOrganization;
        updateDonationSummary();
    });

    /* Amount buttons */
    document.querySelectorAll(".amount-btn").forEach((button) => {
        button.addEventListener("click", () => {
            document.querySelectorAll(".amount-btn").forEach((b) => b.classList.remove("selected"));
            button.classList.add("selected");
            $("amount").value = button.dataset.amount;
            updateDonationSummary();
        });
    });

    $("amount").addEventListener("input", () => {
        document.querySelectorAll(".amount-btn").forEach((b) => b.classList.remove("selected"));
        updateDonationSummary();
    });

    $("purpose").addEventListener("change", updateDonationSummary);

    $("summaryDonateBtn").addEventListener("click", () => {
        $("donationForm").scrollIntoView({ behavior: "smooth", block: "center" });
    });

    $("donationForm").addEventListener("submit", handleDonation);

    updateDonationSummary();
}

function updateDonationSummary() {
    const amount = Number($("amount").value) || 0;
    $("summaryOrg").textContent = state.selectedOrganization || "Not selected";
    $("summaryPurpose").textContent = $("purpose").value;
    $("summaryAmount").textContent = formatCurrency(amount);
    $("summaryTotal").textContent = formatCurrency(amount);
}

function resetDonationForm() {
    $("donationForm").reset();
    document.querySelectorAll(".org-card").forEach((c) => c.classList.remove("selected"));
    document.querySelectorAll(".amount-btn").forEach((b) => b.classList.remove("selected"));
    state.selectedOrganization = "";
    $("organization").value = "";
    prefillDonor();
    updateDonationSummary();
}

async function handleDonation(e) {
    e.preventDefault();
    if (state.donating) return;

    const donorName = $("donorName").value.trim();
    const donorEmail = $("donorEmail").value.trim().toLowerCase();
    const organization = $("organization").value;
    const amount = Number($("amount").value);
    const purpose = $("purpose").value;
    const terms = $("terms").checked;

    if (!donorName || !donorEmail || !organization || !Number.isFinite(amount) || amount <= 0 || !terms) {
        showMessage(
            "donationMessage",
            organization ? "Please complete all donation details correctly." : "Please choose an organization to donate to.",
            "error"
        );
        return;
    }

    if (typeof window.Razorpay === "undefined") {
        showMessage(
            "donationMessage",
            "Razorpay could not be loaded. Please check your internet connection and refresh the page.",
            "error"
        );
        return;
    }

    const button = e.target.querySelector('button[type="submit"]');
    state.donating = true;
    clearMessage("donationMessage");
    setBusy(button, true, "Starting payment...");

    const finish = () => {
        state.donating = false;
        setBusy(button, false);
    };

    let order;
    try {
        order = await api("/donations/create-order", {
            method: "POST",
            body: { donorName, donorEmail, organization, amount, purpose },
            noLogout: true
        });
    } catch (err) {
        showMessage("donationMessage", err.message, "error");
        finish();
        return;
    }

    const user = currentUser();
    const prefill = { name: donorName, email: donorEmail };
    if (user && user.role === "donor" && /^[0-9]{10}$/.test(user.phone || "")) {
        prefill.contact = user.phone;
    }

    let paymentDone = false;

    const options = {
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "TrustDonate",
        description: "Donation to " + organization + " (" + purpose + ")",
        order_id: order.orderId,
        prefill,
        notes: { donationId: order.donationId },
        theme: { color: "#2563eb" },

        handler: async function (response) {
            paymentDone = true;
            try {
                setBusy(button, true, "Confirming payment...");
                const result = await api("/donations/verify", {
                    method: "POST",
                    body: {
                        razorpay_order_id: response.razorpay_order_id,
                        razorpay_payment_id: response.razorpay_payment_id,
                        razorpay_signature: response.razorpay_signature
                    },
                    noLogout: true
                });
                resetDonationForm();
                showMessage("donationMessage", "Payment successful. Donation recorded.", "success");
                openSuccessModal(result.donation.id);
            } catch (err) {
                showMessage(
                    "donationMessage",
                    err.message + " (Reference: " + order.donationId + ")",
                    "error"
                );
            } finally {
                finish();
            }
        },

        modal: {
            ondismiss: function () {
                if (state.donating && !paymentDone) {
                    showMessage("donationMessage", "Payment was cancelled. You have not been charged.", "info");
                    finish();
                }
            }
        }
    };

    try {
        const rzp = new window.Razorpay(options);
        rzp.on("payment.failed", function (response) {
            const reason = response?.error?.description || "Payment failed. Please try again.";
            showMessage("donationMessage", reason, "error");
            finish();
        });
        rzp.open();
    } catch (err) {
        showMessage("donationMessage", "Could not open the payment window.", "error");
        finish();
    }
}

/* =========================================================
   SUCCESS MODAL
   ========================================================= */

function openSuccessModal(id) {
    state.latestDonationId = id;
    $("modalDonationId").textContent = id;
    $("successModal").classList.add("show");
}

function closeSuccessModal() {
    $("successModal").classList.remove("show");
}

function setupModal() {
    $("modalCloseBtn").addEventListener("click", closeSuccessModal);

    $("modalTrackBtn").addEventListener("click", () => {
        closeSuccessModal();
        navigate("track");
        setTimeout(() => {
            $("trackingId").value = state.latestDonationId;
            showTrackingResult(state.latestDonationId);
        }, 300);
    });

    $("successModal").addEventListener("click", (e) => {
        if (e.target.id === "successModal") closeSuccessModal();
    });
}

/* =========================================================
   DONOR DASHBOARD
   ========================================================= */

async function renderDonorDashboard() {
    const user = currentUser();
    if (!user || user.role !== "donor") {
        navigate("login");
        return;
    }

    $("donorWelcome").textContent = "Welcome, " + user.name + "!";

    try {
        const { donations } = await api("/donations/mine");
        state.donorDonations = donations;

        const total = donations.reduce((sum, d) => sum + Number(d.amount), 0);
        const verified = donations.filter((d) => d.status === "Verified").length;
        const organizations = new Set(donations.map((d) => d.organization)).size;

        $("totalDonated").textContent = formatCurrency(total);
        $("donationCount").textContent = donations.length;
        $("verifiedCount").textContent = verified;
        $("organizationCount").textContent = organizations;

        const query = $("donationSearch").value.toLowerCase();
        renderDonorTable(
            query
                ? donations.filter((d) => JSON.stringify(d).toLowerCase().includes(query))
                : donations
        );
    } catch (e) {
        handleDashboardError(e);
    }
}

function renderDonorTable(donations) {
    const body = $("donationTableBody");
    const empty = $("emptyDonations");
    body.innerHTML = "";

    if (donations.length === 0) {
        empty.classList.remove("hidden");
        return;
    }
    empty.classList.add("hidden");

    donations.forEach((donation) => {
        const tr = document.createElement("tr");
        const statusClass = donation.status === "Verified" ? "status-verified" : "status-pending";
        tr.innerHTML = `
            <td><strong>${escapeHTML(donation.id)}</strong></td>
            <td>${escapeHTML(donation.organization)}</td>
            <td>${formatCurrency(donation.amount)}</td>
            <td>${escapeHTML(donation.purpose)}</td>
            <td><span class="status ${statusClass}">${escapeHTML(donation.status)}</span></td>
            <td>${formatDate(donation.date)}</td>
            <td><button class="action-btn" data-receipt="${escapeHTML(donation.id)}">Receipt</button></td>
        `;
        body.appendChild(tr);
    });

    body.querySelectorAll("[data-receipt]").forEach((button) => {
        button.addEventListener("click", () => generateReceipt(button.dataset.receipt));
    });
}

function setupDonorSearch() {
    $("donationSearch").addEventListener("input", () => {
        const query = $("donationSearch").value.toLowerCase();
        renderDonorTable(
            state.donorDonations.filter((d) => JSON.stringify(d).toLowerCase().includes(query))
        );
    });
}

/* =========================================================
   RECEIPT
   ========================================================= */

function generateReceipt(id) {
    const donation = state.donorDonations.find((d) => d.id === id);
    if (!donation) return;

    const win = window.open("", "_blank", "width=850,height=750");
    if (!win) {
        toast("Please allow pop-ups to generate the receipt.");
        return;
    }

    const verified = donation.status === "Verified";

    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Donation Receipt - ${escapeHTML(donation.id)}</title>
<style>
body{font-family:Arial,sans-serif;background:#f8fafc;padding:40px;color:#0f172a}
.receipt{max-width:700px;margin:auto;background:#fff;padding:45px;border-radius:18px;box-shadow:0 15px 45px rgba(0,0,0,.08)}
h1{color:#2563eb}
.line{display:flex;justify-content:space-between;gap:20px;padding:13px 0;border-bottom:1px solid #e2e8f0}
.amount{font-size:30px;font-weight:bold;color:#16a34a}
.verified{color:#16a34a;font-weight:bold}
.pending{color:#d97706;font-weight:bold}
button{margin-top:25px;padding:12px 18px;border:0;background:#2563eb;color:#fff;border-radius:8px;cursor:pointer}
@media print{button{display:none}body{background:#fff;padding:0}.receipt{box-shadow:none}}
</style>
</head>
<body>
<div class="receipt">
<h1>♥ TrustDonate</h1>
<p>Official Donation Receipt</p>
<hr>
<div class="line"><strong>Donation ID</strong><span>${escapeHTML(donation.id)}</span></div>
<div class="line"><strong>Donor</strong><span>${escapeHTML(donation.donorName)}</span></div>
<div class="line"><strong>Organization</strong><span>${escapeHTML(donation.organization)}</span></div>
<div class="line"><strong>Purpose</strong><span>${escapeHTML(donation.purpose)}</span></div>
<div class="line"><strong>Date</strong><span>${formatDate(donation.date)}</span></div>
<div class="line"><strong>Payment ID</strong><span>${escapeHTML(donation.paymentId || "-")}</span></div>
<div class="line"><strong>Amount</strong><span class="amount">${formatCurrency(donation.amount)}</span></div>
<p class="${verified ? "verified" : "pending"}">${verified ? "✓ Donation Verified" : "◷ Verification Pending"}</p>
<p>Bank Status: ${escapeHTML(donation.bankStatus)}</p>
<p>Blockchain Reference: ${escapeHTML(donation.blockchainHash || "Pending")}</p>
<button onclick="window.print()">Print / Save as PDF</button>
</div>
</body>
</html>`);
    win.document.close();
}

/* =========================================================
   TRACKING
   ========================================================= */

function setupTracking() {
    $("trackForm").addEventListener("submit", (e) => {
        e.preventDefault();
        showTrackingResult($("trackingId").value.trim().toUpperCase());
    });
}

async function showTrackingResult(id) {
    const result = $("trackingResult");
    result.innerHTML = `<div class="track-result"><p>Searching...</p></div>`;

    let donation;
    try {
        ({ donation } = await api("/track/" + encodeURIComponent(id), { noLogout: true }));
    } catch (err) {
        result.innerHTML = `
            <div class="track-result">
                <div class="alert alert-error">
                    ${err.status === 404
                        ? `No donation found with ID <strong>${escapeHTML(id)}</strong>.`
                        : escapeHTML(err.message)}
                </div>
            </div>`;
        return;
    }

    const verified = donation.status === "Verified";
    const deposited = donation.bankStatus === "Deposited";

    result.innerHTML = `
        <div class="track-result">
            <h2>Donation <span class="tracking-id">${escapeHTML(donation.id)}</span></h2>

            <div class="detail-grid">
                <div class="detail-box"><small>Donor</small><strong>${escapeHTML(donation.donorName)}</strong></div>
                <div class="detail-box"><small>Organization</small><strong>${escapeHTML(donation.organization)}</strong></div>
                <div class="detail-box"><small>Amount</small><strong>${formatCurrency(donation.amount)}</strong></div>
            </div>

            <div class="timeline">
                <div class="timeline-item">
                    <div class="timeline-dot">✓</div>
                    <div><h4>Donation Created</h4><p>${formatDate(donation.date)}</p></div>
                </div>
                <div class="timeline-item">
                    <div class="timeline-dot">✓</div>
                    <div><h4>Payment Confirmed</h4><p>Paid securely via Razorpay on ${formatDate(donation.paidAt)}.</p></div>
                </div>
                <div class="timeline-item">
                    <div class="timeline-dot">${deposited ? "✓" : "!"}</div>
                    <div><h4>Organization Received Funds</h4><p>Bank status: ${escapeHTML(donation.bankStatus)}</p></div>
                </div>
                <div class="timeline-item">
                    <div class="timeline-dot">${verified ? "✓" : "!"}</div>
                    <div><h4>Financial Verification</h4><p>Status: ${escapeHTML(donation.status)}${verified && donation.verifiedAt ? " on " + formatDate(donation.verifiedAt) : ""}</p></div>
                </div>
            </div>

            <div class="blockchain-box">
                <small>Blockchain Reference</small>
                <code>${escapeHTML(donation.blockchainHash || "Pending CA verification")}</code>
            </div>
        </div>`;
}

/* =========================================================
   ORGANIZATION DASHBOARD
   ========================================================= */

async function renderOrganizationDashboard() {
    const user = currentUser();
    if (!user || user.role !== "organization") {
        navigate("login");
        return;
    }

    $("organizationWelcome").textContent = user.organizationName || user.name;

    try {
        const { organization, donations } = await api("/donations/organization");
        $("organizationWelcome").textContent = organization;

        const total = donations.reduce((sum, d) => sum + Number(d.amount), 0);
        const verified = donations.filter((d) => d.status === "Verified").length;

        $("orgTotal").textContent = formatCurrency(total);
        $("orgDonationCount").textContent = donations.length;
        $("orgVerified").textContent = verified;
        $("orgPending").textContent = donations.length - verified;

        const body = $("organizationTableBody");
        body.innerHTML = "";

        if (donations.length === 0) {
            body.innerHTML = `<tr><td colspan="6">No donation records available.</td></tr>`;
            return;
        }

        donations.forEach((donation) => {
            const tr = document.createElement("tr");
            const statusClass = donation.status === "Verified" ? "status-verified" : "status-pending";
            tr.innerHTML = `
                <td><strong>${escapeHTML(donation.id)}</strong></td>
                <td>${escapeHTML(donation.donorName)}</td>
                <td>${formatCurrency(donation.amount)}</td>
                <td>${escapeHTML(donation.purpose)}</td>
                <td><span class="status ${statusClass}">${escapeHTML(donation.status)}</span></td>
                <td>${formatDate(donation.date)}</td>
            `;
            body.appendChild(tr);
        });
    } catch (e) {
        handleDashboardError(e);
    }
}

/* =========================================================
   CA DASHBOARD
   ========================================================= */

async function renderCADashboard() {
    const user = currentUser();
    if (!user || user.role !== "ca") {
        navigate("login");
        return;
    }

    try {
        const { donations } = await api("/donations/all");

        const verified = donations.filter((d) => d.status === "Verified").length;
        const value = donations.reduce((sum, d) => sum + Number(d.amount), 0);

        $("caTotalRecords").textContent = donations.length;
        $("caVerified").textContent = verified;
        $("caPending").textContent = donations.length - verified;
        $("caValue").textContent = formatCurrency(value);

        const body = $("caTableBody");
        body.innerHTML = "";

        if (donations.length === 0) {
            body.innerHTML = `<tr><td colspan="6">No donation records available.</td></tr>`;
            return;
        }

        donations.forEach((donation) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${escapeHTML(donation.id)}</strong></td>
                <td>${escapeHTML(donation.organization)}</td>
                <td>${escapeHTML(donation.donorName)}</td>
                <td>${formatCurrency(donation.amount)}</td>
                <td><span class="status status-confirmed">${escapeHTML(donation.bankStatus)}</span></td>
                <td>${donation.status === "Verified"
                    ? `<span class="status status-verified">✓ Verified</span>`
                    : `<button class="action-btn verify-btn" data-verify="${escapeHTML(donation.id)}">Verify</button>`}</td>
            `;
            body.appendChild(tr);
        });

        body.querySelectorAll("[data-verify]").forEach((button) => {
            button.addEventListener("click", () => verifyDonation(button.dataset.verify, button));
        });
    } catch (e) {
        handleDashboardError(e);
    }
}

async function verifyDonation(id, button) {
    setBusy(button, true, "Verifying...");
    try {
        await api("/donations/" + encodeURIComponent(id) + "/verify", { method: "POST" });
        toast("Donation verified successfully.");
        await renderCADashboard();
    } catch (e) {
        setBusy(button, false);
        handleDashboardError(e);
    }
}

/* =========================================================
   THEME + MOBILE MENU + GLOBAL EVENTS
   ========================================================= */

function updateThemeIcon() {
    const button = $("themeBtn");
    if (!button) return;
    button.textContent = document.body.classList.contains("dark") ? "☀" : "☾";
}

function setupTheme() {
    if (localStorage.getItem(THEME_KEY) === "dark") {
        document.body.classList.add("dark");
    }
    updateThemeIcon();

    $("themeBtn").addEventListener("click", () => {
        document.body.classList.toggle("dark");
        localStorage.setItem(THEME_KEY, document.body.classList.contains("dark") ? "dark" : "light");
        updateThemeIcon();
    });
}

function setupMobileMenu() {
    $("menuBtn").addEventListener("click", () => $("navLinks").classList.toggle("open"));
}

function setupGlobalNavigation() {
    document.querySelectorAll("[data-page]").forEach((element) => {
        element.addEventListener("click", (e) => {
            e.preventDefault();
            navigate(element.dataset.page);
        });
    });

    window.addEventListener("hashchange", () => {
        navigate(location.hash.replace("#", "") || "home");
    });
}

/* =========================================================
   INITIALIZATION
   ========================================================= */

async function initialize() {
    setupTheme();
    setupMobileMenu();
    setupGlobalNavigation();
    setupLogin();
    setupRegistration();
    setupDonation();
    setupModal();
    setupDonorSearch();
    setupTracking();

    await validateSession();
    updateNavigation();
    loadOrganizations();

    navigate(location.hash.replace("#", "") || "home");
}

document.addEventListener("DOMContentLoaded", initialize);