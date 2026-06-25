const photoInput = document.querySelector("#profilePhotoInput");
const avatarPreview = document.querySelector("#avatarPreview");

const validationMessages = {
    valueMissing: "This field is required.",
    tooShort: "Please enter a little more detail.",
    tooLong: "Please shorten this value.",
    patternMismatch: "Use only letters, numbers, and underscores.",
    typeMismatch: "Please enter a valid value."
};

function messageFor(input) {
    if (input.validity.valueMissing) return validationMessages.valueMissing;
    if (input.validity.tooShort) return `Use at least ${input.minLength} characters.`;
    if (input.validity.tooLong) return `Use no more than ${input.maxLength} characters.`;
    if (input.validity.patternMismatch) return validationMessages.patternMismatch;
    if (input.validity.typeMismatch) return validationMessages.typeMismatch;
    return input.validationMessage || "";
}

function setFieldState(input) {
    const field = input.closest(".form-field");
    const error = field?.querySelector(".field-error");
    const showError = input.matches(":invalid") && (input.dataset.touched === "true" || input.closest("form")?.dataset.submitted === "true");

    input.setAttribute("aria-invalid", showError ? "true" : "false");
    field?.classList.toggle("has-error", showError);
    if (error) error.textContent = showError ? messageFor(input) : "";
}

function syncPasswordConfirmation(form) {
    const password = form.querySelector("#registerPassword");
    const confirm = form.querySelector("#registerConfirmPassword");
    if (!password || !confirm) return;
    const mismatch = confirm.value && password.value !== confirm.value;
    confirm.setCustomValidity(mismatch ? "Passwords do not match." : "");
}

function setupAuthForm(form) {
    const inputs = Array.from(form.querySelectorAll("input:not([type='hidden'])"));

    inputs.forEach((input) => {
        input.setAttribute("aria-invalid", "false");
        input.addEventListener("blur", () => {
            input.dataset.touched = "true";
            syncPasswordConfirmation(form);
            setFieldState(input);
        });
        input.addEventListener("input", () => {
            syncPasswordConfirmation(form);
            if (input.dataset.touched === "true" || form.dataset.submitted === "true") {
                setFieldState(input);
            }
            if (input.id === "registerPassword") {
                const confirm = form.querySelector("#registerConfirmPassword");
                if (confirm) setFieldState(confirm);
            }
        });
        input.addEventListener("invalid", (event) => {
            event.preventDefault();
            input.dataset.touched = "true";
            setFieldState(input);
        });
    });

    form.addEventListener("submit", (event) => {
        form.dataset.submitted = "true";
        syncPasswordConfirmation(form);
        inputs.forEach(setFieldState);
        const firstInvalid = inputs.find((input) => !input.validity.valid);
        if (firstInvalid) {
            event.preventDefault();
            firstInvalid.focus();
        }
    });
}

document.querySelectorAll("[data-auth-form]").forEach(setupAuthForm);

function readMessageSideAuth() {
    return window.AppUtils?.readMessageSide?.() || (
        localStorage.getItem("pulsechat-message-side") === "sender" ? "sender" : "receiver"
    );
}

function setAuthMessageSide(side) {
    const mode = window.AppUtils?.writeMessageSide?.(side) || (side === "sender" ? "sender" : "receiver");
    if (!window.AppUtils?.writeMessageSide) {
        localStorage.setItem("pulsechat-message-side", mode);
    }
    document.querySelectorAll("[data-side-toggle] .side-toggle-btn").forEach((button) => {
        const active = button.dataset.side === mode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    document.querySelectorAll("[data-auth-preview]").forEach((preview) => {
        preview.classList.toggle("flip-sides", mode === "sender");
    });
}

document.querySelectorAll("[data-side-toggle]").forEach((group) => {
    group.querySelectorAll(".side-toggle-btn").forEach((button) => {
        button.addEventListener("click", () => setAuthMessageSide(button.dataset.side));
    });
});

setAuthMessageSide(readMessageSideAuth());

document.querySelectorAll("[data-username]").forEach((button) => {
    button.addEventListener("pointerdown", () => button.classList.add("is-pressed"));
    button.addEventListener("pointerup", () => button.classList.remove("is-pressed"));
    button.addEventListener("pointerleave", () => button.classList.remove("is-pressed"));
    button.addEventListener("click", () => {
        const usernameInput = document.querySelector("#loginUsername");
        const passwordInput = document.querySelector("#loginPassword");
        if (!usernameInput || !passwordInput) return;
        usernameInput.value = button.dataset.username;
        usernameInput.dataset.touched = "true";
        setFieldState(usernameInput);
        if (button.dataset.password) {
            passwordInput.value = button.dataset.password;
            passwordInput.dataset.touched = "true";
            setFieldState(passwordInput);
        }
        passwordInput.focus();
    });
});

if (photoInput) {
    photoInput.addEventListener("change", () => {
        const [file] = photoInput.files;
        if (!file) return;
        const target = avatarPreview || document.createElement("img");
        target.id = "avatarPreview";
        target.src = URL.createObjectURL(file);
        if (!avatarPreview) {
            document.querySelector(".avatar-xl").appendChild(target);
        }
    });
}
