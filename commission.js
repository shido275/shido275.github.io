// ==============================================
// EXCLUSIVE COMMISSIONS
// A static page has no server, so the brief posts to a form-to-email relay
// that delivers it as a table to the artist inbox. The relay asks for a
// one-time activation click on the very first submission; after that every
// brief arrives on its own. If the relay is unreachable the form falls back
// to a prefilled mail draft so a brief is never lost.
// ==============================================

const COMMISSION_ENDPOINT = `https://formsubmit.co/ajax/${SITE_CONFIG.contactEmail}`;

function commissionBriefText(brief) {
    return [
        "Exclusive commission brief",
        "",
        `Name: ${brief.name}`,
        `Email: ${brief.email}`,
        `Artist / project: ${brief.artist}`,
        `Beat or reference: ${brief.beat}`,
        `Starting point: ${brief.tier}`,
        `Budget: ${brief.budget}`,
        "",
        "How it will be used:",
        brief.usage,
        "",
        "Anything else:",
        brief.notes
    ].join("\n");
}

function initCommissionForm() {
    const form = document.querySelector("#commission-form");
    if (!form) return;

    const status = form.querySelector("[data-commission-status]");
    const submit = form.querySelector('button[type="submit"]');
    const idleLabel = submit ? submit.textContent : "Send Commission Brief";
    const idleStatus = status ? status.textContent : "";

    const setStatus = (html, state) => {
        if (!status) return;
        status.classList.remove("is-success", "is-error");
        if (state) status.classList.add(state);
        status.innerHTML = html;
    };

    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (!form.reportValidity()) return;

        const data = new FormData(form);
        const value = key => String(data.get(key) || "").trim();
        if (value("_honey")) return; // filled only by bots

        const brief = {
            name: value("name"),
            email: value("email"),
            artist: value("artist"),
            beat: value("beat"),
            tier: value("tier"),
            budget: value("budget"),
            usage: value("usage"),
            notes: value("notes")
        };

        const subject = `Exclusive commission - ${brief.name || "new brief"}`;
        const fallback = `mailto:${SITE_CONFIG.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(commissionBriefText(brief))}`;

        if (submit) {
            submit.disabled = true;
            submit.textContent = "Sending...";
        }
        setStatus("Sending the brief to the studio inbox...", "");

        try {
            const response = await fetch(COMMISSION_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({
                    _subject: subject,
                    _template: "table",
                    _captcha: "false",
                    _replyto: brief.email,
                    "Name": brief.name,
                    "Email": brief.email,
                    "Artist / project": brief.artist,
                    "Beat or reference": brief.beat,
                    "Starting point": brief.tier,
                    "Budget": brief.budget,
                    "How it will be used": brief.usage,
                    "Anything else": brief.notes
                })
            });
            if (!response.ok) throw new Error(`Mail relay answered ${response.status}`);
            form.reset();
            setStatus(`Sent to ${SITE_CONFIG.contactEmail}. A reply comes back to the address you left.`, "is-success");
        } catch (error) {
            console.warn("Commission brief could not be sent:", error);
            setStatus(`The mail relay did not answer. <a href="${fallback}">Send the same brief from your mail app</a>, or write to ${SITE_CONFIG.contactEmail}.`, "is-error");
        } finally {
            if (submit) {
                submit.disabled = false;
                submit.textContent = idleLabel;
            }
            if (status && !status.innerHTML) status.textContent = idleStatus;
        }
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCommissionForm);
} else {
    initCommissionForm();
}
