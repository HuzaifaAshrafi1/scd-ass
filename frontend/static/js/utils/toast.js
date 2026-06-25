(() => {
    function createToastStack() {
        let stack = document.querySelector("#toastStack");
        if (!stack) {
            stack = document.createElement("div");
            stack.id = "toastStack";
            stack.className = "toast-stack";
            stack.setAttribute("role", "region");
            stack.setAttribute("aria-label", "Notifications");
            stack.setAttribute("aria-live", "polite");
            document.body.appendChild(stack);
        }
        return stack;
    }

    function toast(message, kind = "info", stack = null) {
        const toastStack = stack || createToastStack();
        const item = document.createElement("div");
        item.className = `toast toast-${kind} notification-card`;
        item.setAttribute("role", kind === "error" ? "alert" : "status");
        item.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
        item.textContent = message;
        const dismiss = () => {
            item.classList.remove("is-visible");
            item.classList.add("is-exiting");
            window.setTimeout(() => item.remove(), 180);
        };
        item.addEventListener("click", dismiss);
        toastStack.appendChild(item);
        requestAnimationFrame(() => {
            item.classList.add("is-visible", "is-entering");
            window.setTimeout(() => item.classList.remove("is-entering"), 260);
        });
        window.setTimeout(dismiss, 4200);
    }

    window.AppUtils = window.AppUtils || {};
    window.AppUtils.toast = toast;
})();
