(() => {
    const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "😡", "🎉", "🔥"];

    let deps = null;
    let reactionHideTimer = null;
    let previousLightboxFocus = null;

    const ui = {};

    function init(dependencies) {
        deps = dependencies;
        bindUi();
        bindGlobalEvents();
    }

    function bindUi() {
        ui.pinnedBar = document.querySelector("#pinnedBar");
        ui.pinnedText = document.querySelector("#pinnedText");
        ui.pinnedUnpin = document.querySelector("#pinnedUnpinBtn");
        ui.selectionToolbar = document.querySelector("#selectionToolbar");
        ui.selectionCount = document.querySelector("#selectionCount");
        ui.reactionPicker = document.querySelector("#reactionPicker");
        ui.deleteModal = document.querySelector("#deleteModal");
        ui.deleteScrim = document.querySelector("#deleteModalScrim");
        ui.forwardModal = document.querySelector("#forwardModal");
        ui.forwardScrim = document.querySelector("#forwardModalScrim");
        ui.forwardList = document.querySelector("#forwardList");
        ui.lightbox = document.querySelector("#imageLightbox");
        ui.searchNav = document.querySelector("#messageSearchNav");
        ui.searchCount = document.querySelector("#messageSearchCount");

        ui.pinnedBar?.addEventListener("click", (event) => {
            if (event.target.closest("#pinnedUnpinBtn")) return;
            jumpToPinned();
        });
        ui.pinnedUnpin?.addEventListener("click", (event) => {
            event.stopPropagation();
            unpinMessage();
        });

        document.querySelector("#deleteForMeBtn")?.addEventListener("click", () => confirmDelete("me"));
        document.querySelector("#deleteForEveryoneBtn")?.addEventListener("click", () => confirmDelete("everyone"));
        document.querySelector("#deleteCancelBtn")?.addEventListener("click", closeDeleteModal);
        ui.deleteScrim?.addEventListener("click", closeDeleteModal);

        document.querySelector("#forwardSubmitBtn")?.addEventListener("click", submitForward);
        document.querySelector("#forwardCancelBtn")?.addEventListener("click", closeForwardModal);
        ui.forwardScrim?.addEventListener("click", closeForwardModal);

        document.querySelector("#selectionCopyBtn")?.addEventListener("click", copySelected);
        document.querySelector("#selectionForwardBtn")?.addEventListener("click", openForwardForSelection);
        document.querySelector("#selectionDeleteBtn")?.addEventListener("click", openDeleteForSelection);
        document.querySelector("#selectionCancelBtn")?.addEventListener("click", exitSelectMode);

        document.querySelector("#searchPrevBtn")?.addEventListener("click", () => navigateSearch(-1));
        document.querySelector("#searchNextBtn")?.addEventListener("click", () => navigateSearch(1));

        ui.lightbox?.addEventListener("click", (event) => {
            if (event.target === ui.lightbox || event.target.closest(".lightbox-close")) {
                closeLightbox();
            }
        });
        document.querySelector("#lightboxDownloadBtn")?.addEventListener("click", () => {
            const img = ui.lightbox?.querySelector("img");
            if (img?.src) window.open(img.src, "_blank", "noopener");
        });

        if (ui.reactionPicker) {
            ui.reactionPicker.setAttribute("aria-label", "Choose a message reaction");
            ui.reactionPicker.replaceChildren();
            for (const emoji of REACTIONS) {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = emoji;
                button.setAttribute("aria-label", `React with ${emoji}`);
                button.addEventListener("click", () => toggleReaction(emoji));
                ui.reactionPicker.appendChild(button);
            }
        }
    }

    function bindGlobalEvents() {
        document.addEventListener("click", (event) => {
            if (!ui.reactionPicker?.contains(event.target) && !event.target.closest("[data-open-reactions]")) {
                hideReactionPicker();
            }
        });
        document.addEventListener("keydown", (event) => {
            if (ui.lightbox?.classList.contains("hidden")) return;
            if (event.key === "Escape") {
                event.preventDefault();
                closeLightbox();
            }
            if (event.key.toLowerCase() === "o") {
                event.preventDefault();
                document.querySelector("#lightboxDownloadBtn")?.click();
            }
        });
    }

    function enhanceMessageRow(row, message) {
        if (!deps || !row) return;

        if (message.client_status === "failed") row.classList.add("is-failed");
        if (deps.state.selectedMessages?.has(message.id)) row.classList.add("is-selected");

        const bubble = row.querySelector(".message-bubble");
        if (message.is_forwarded && message.forward_from_name && bubble) {
            const label = document.createElement("div");
            label.className = "message-forward-label";
            label.textContent = `Forwarded from ${message.forward_from_name}`;
            bubble.prepend(label);
        }

        const footer = row.querySelector(".message-footer");
        const statusNode = footer?.querySelector(".message-status:not([data-client])");
        if (statusNode) {
            statusNode.classList.add("message-status-icon");
            statusNode.title = statusNode.getAttribute("aria-label") || statusNode.textContent;
        }

        if (message.client_status && footer) {
            const clientStatus = document.createElement("span");
            clientStatus.className = "message-status message-status-icon";
            clientStatus.dataset.status = message.client_status;
            clientStatus.dataset.client = "true";
            clientStatus.textContent = clientStatusLabel(message.client_status);
            footer.prepend(clientStatus);
            if (message.client_status === "failed") {
                const retry = document.createElement("button");
                retry.type = "button";
                retry.className = "message-retry-btn";
                retry.textContent = "Retry";
                retry.addEventListener("click", () => retryMessage(message));
                footer.appendChild(retry);
            }
        }

        if (message.edited_at && footer) {
            const edited = document.createElement("span");
            edited.className = "message-edited-label";
            edited.textContent = "Edited";
            footer.insertBefore(edited, footer.firstChild);
        }

        if (message.read_count != null && message.sender.id === deps.currentUserId && footer) {
            const read = document.createElement("span");
            read.className = "message-status message-status-icon";
            read.dataset.status = "seen";
            read.title = `Read by ${message.read_count}`;
            read.textContent = `Seen ${message.read_count}`;
            footer.appendChild(read);
        }

        renderReactions(row, message);

        const image = row.querySelector(".chat-image");
        if (image) {
            image.loading = "lazy";
            image.decoding = "async";
            image.addEventListener("error", () => {
                image.classList.add("is-broken");
                image.alt = "Attachment preview could not be loaded";
            });
            image.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                openLightbox(image.src, image.alt);
            });
        }

        let pressTimer = null;
        let pressStartX = 0;
        let pressStartY = 0;
        row.addEventListener("pointerdown", (event) => {
            if (message.is_deleted) return;
            if (event.pointerType === "mouse") return;
            if (event.target.closest("button, a, input, textarea")) return;
            pressStartX = event.clientX;
            pressStartY = event.clientY;
            pressTimer = window.setTimeout(() => enterSelectMode(message.id), 500);
        });
        row.addEventListener("pointermove", (event) => {
            if (Math.abs(event.clientX - pressStartX) > 18 || Math.abs(event.clientY - pressStartY) > 18) {
                window.clearTimeout(pressTimer);
            }
        });
        row.addEventListener("pointerup", () => window.clearTimeout(pressTimer));
        row.addEventListener("pointerleave", () => window.clearTimeout(pressTimer));

        row.addEventListener("click", (event) => {
            if (event.target.closest("button, a, input, textarea")) return;
            if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                if (!deps.state.selectMode) enterSelectMode(message.id);
                else toggleSelectMessage(message.id);
                return;
            }
            if (deps.state.selectMode) toggleSelectMessage(message.id);
        });

        row.addEventListener("dblclick", (event) => {
            if (message.sender.id !== deps.currentUserId || message.is_deleted) return;
            if (event.target.closest("button, a")) return;
            startEdit(message, row);
        });

        bindSwipeToReply(row, message);
    }

    function bindSwipeToReply(row, message) {
        if (message.is_deleted || row.dataset.swipeReplyBound === "true") return;
        row.dataset.swipeReplyBound = "true";
        let startX = 0;
        let startY = 0;
        let swipeX = 0;
        let tracking = false;

        row.addEventListener("pointerdown", (event) => {
            if (!["touch", "pen"].includes(event.pointerType)) return;
            if (event.target.closest("button, a, input, textarea")) return;
            startX = event.clientX;
            startY = event.clientY;
            swipeX = 0;
            tracking = true;
            row.classList.add("is-swipe-tracking");
        });

        row.addEventListener("pointermove", (event) => {
            if (!tracking) return;
            const dx = Math.max(0, event.clientX - startX);
            const dy = Math.abs(event.clientY - startY);
            if (dy > 28 && dx < 32) {
                tracking = false;
                row.classList.remove("is-swipe-tracking", "is-swipe-ready");
                row.style.removeProperty("--swipe-x");
                return;
            }
            swipeX = Math.min(dx, 92);
            row.style.setProperty("--swipe-x", `${swipeX}px`);
            row.classList.toggle("is-swipe-ready", swipeX > 68);
        });

        const finishSwipe = () => {
            if (!tracking) return;
            tracking = false;
            const shouldReply = swipeX > 68;
            row.classList.remove("is-swipe-tracking", "is-swipe-ready");
            row.style.removeProperty("--swipe-x");
            if (shouldReply) deps.startReply?.(message);
        };

        row.addEventListener("pointerup", finishSwipe);
        row.addEventListener("pointercancel", finishSwipe);
    }

    function clientStatusLabel(status) {
        const labels = {
            sending: "Sending",
            queued: "Queued",
            retrying: "Retrying",
            failed: "Failed"
        };
        return labels[status] || status;
    }

    function renderReactions(row, message) {
        const bubble = row.querySelector(".message-bubble");
        row.classList.toggle("has-reactions", Boolean(message.reactions?.length));
        if (!bubble) return;
        if (!message.reactions?.length) {
            bubble.querySelector(".message-reactions")?.remove();
            return;
        }
        let wrap = bubble.querySelector(".message-reactions");
        if (!wrap) {
            wrap = document.createElement("div");
            wrap.className = "message-reactions";
            const footer = bubble.querySelector(".message-footer");
            bubble.insertBefore(wrap, footer);
        }
        wrap.replaceChildren();
        for (const reaction of message.reactions) {
            const pill = document.createElement("button");
            pill.type = "button";
            pill.className = `reaction-pill${reaction.mine ? " mine is-pop" : ""}`;
            pill.title = reaction.users.map((user) => user.display_name).join(", ");
            pill.setAttribute(
                "aria-label",
                `${reaction.mine ? "Remove" : "Add"} ${reaction.emoji} reaction, ${reaction.count} total`
            );
            const emoji = document.createElement("span");
            emoji.className = "reaction-emoji";
            emoji.setAttribute("aria-hidden", "true");
            emoji.textContent = reaction.emoji;
            const count = document.createElement("span");
            count.className = "reaction-count";
            count.textContent = reaction.count;
            pill.append(emoji, count);
            pill.addEventListener("click", (event) => {
                event.stopPropagation();
                toggleReaction(reaction.emoji, message);
            });
            wrap.appendChild(pill);
        }
    }

    async function toggleReaction(emoji, message = deps?.state.contextMessage) {
        if (!message) return;
        hideReactionPicker();
        try {
            const payload = await deps.api(`/api/messages/${message.id}/reactions`, {
                method: "POST",
                body: { emoji }
            });
            const target = deps.state.messages.find((item) => item.id === message.id);
            if (target) target.reactions = payload.reactions;
            deps.renderMessages();
        } catch (error) {
            deps.toast(error.message, "error");
        }
    }

    function showReactionPicker(event, message) {
        if (!ui.reactionPicker) return;
        window.clearTimeout(reactionHideTimer);
        deps.state.contextMessage = message;
        ui.reactionPicker.classList.remove("hidden");
        requestAnimationFrame(() => ui.reactionPicker?.classList.add("is-open"));
        const pickerWidth = ui.reactionPicker.offsetWidth || 300;
        const pickerHeight = ui.reactionPicker.offsetHeight || 56;
        const margin = 12;
        const x = Math.min(
            Math.max(margin, event.clientX - pickerWidth / 2),
            window.innerWidth - pickerWidth - margin
        );
        const y = Math.min(
            Math.max(margin, event.clientY - pickerHeight - 8),
            window.innerHeight - pickerHeight - margin
        );
        ui.reactionPicker.style.left = `${x}px`;
        ui.reactionPicker.style.top = `${y}px`;
    }

    function hideReactionPicker() {
        if (!ui.reactionPicker) return;
        ui.reactionPicker.classList.remove("is-open");
        window.clearTimeout(reactionHideTimer);
        reactionHideTimer = window.setTimeout(() => {
            if (!ui.reactionPicker?.classList.contains("is-open")) {
                ui.reactionPicker?.classList.add("hidden");
            }
        }, 150);
    }

    function openDeleteModal(message) {
        deps.state.contextMessage = message;
        ui.deleteModal?.classList.remove("hidden");
        ui.deleteScrim?.classList.remove("hidden");
        const everyoneBtn = document.querySelector("#deleteForEveryoneBtn");
        everyoneBtn?.classList.toggle("hidden", message.sender.id !== deps.currentUserId);
        deps.closeMessageContextMenu?.();
    }

    function closeDeleteModal() {
        ui.deleteModal?.classList.add("hidden");
        ui.deleteScrim?.classList.add("hidden");
    }

    async function confirmDelete(scope) {
        const message = deps.state.contextMessage;
        if (!message) return;
        closeDeleteModal();
        try {
            await deps.api(`/api/messages/${message.id}?scope=${scope}`, { method: "DELETE" });
            if (scope === "me") {
                deps.state.messages = deps.state.messages.filter((item) => item.id !== message.id);
            } else {
                const target = deps.state.messages.find((item) => item.id === message.id);
                if (target) {
                    target.is_deleted = true;
                    target.deleted_for_everyone = true;
                    target.body = "";
                    target.attachment = null;
                    target.message_type = "deleted";
                }
            }
            deps.renderMessages();
            deps.toast(scope === "me" ? "Message removed for you." : "Message deleted for everyone.");
            exitSelectMode();
        } catch (error) {
            deps.toast(error.message, "error");
        }
    }

    function parseEditableBody(body = "") {
        const match = body.match(/^\[Reply to ([^:]+): ([^\]]*)\]\n\n?([\s\S]*)$/);
        return match ? match[3] : body;
    }

    function startEdit(message, row) {
        if (!message.body || message.is_deleted) return;
        const bodyNode = row.querySelector(".message-body");
        if (!bodyNode || row.querySelector(".message-edit-input")) return;
        const input = document.createElement("textarea");
        input.className = "message-edit-input";
        input.value = parseEditableBody(message.body);
        input.setAttribute("aria-label", "Edit message");
        bodyNode.replaceWith(input);
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);

        const finish = async (save) => {
            if (!save) {
                deps.renderMessages();
                return;
            }
            const next = input.value.trim();
            if (!next || next === parseEditableBody(message.body)) {
                deps.renderMessages();
                return;
            }
            try {
                const payload = await deps.api(`/api/messages/${message.id}`, {
                    method: "PATCH",
                    body: { body: next }
                });
                Object.assign(message, payload.message);
                deps.renderMessages();
            } catch (error) {
                deps.toast(error.message, "error");
                deps.renderMessages();
            }
        };

        input.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                finish(false);
            }
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                finish(true);
            }
        });
        input.addEventListener("blur", () => finish(true), { once: true });
    }

    function openForwardModal(messages) {
        deps.state.forwardMessages = messages;
        ui.forwardModal?.classList.remove("hidden");
        ui.forwardScrim?.classList.remove("hidden");
        ui.forwardList?.replaceChildren();
        for (const conversation of deps.state.conversations) {
            if (conversation.id === deps.state.activeConversation?.id) continue;
            const item = document.createElement("label");
            item.className = "forward-item";
            const input = document.createElement("input");
            input.type = "checkbox";
            input.value = String(conversation.id);
            const text = document.createElement("span");
            text.textContent = conversation.title;
            item.append(input, text);
            input.addEventListener("change", () => item.classList.toggle("selected", input.checked));
            ui.forwardList?.appendChild(item);
        }
        deps.closeMessageContextMenu?.();
    }

    function closeForwardModal() {
        ui.forwardModal?.classList.add("hidden");
        ui.forwardScrim?.classList.add("hidden");
    }

    async function submitForward() {
        const ids = Array.from(ui.forwardList?.querySelectorAll("input:checked") || []).map(
            (input) => Number(input.value)
        );
        const source = deps.state.forwardMessages?.[0];
        if (!source || !ids.length) return;
        try {
            await deps.api(`/api/messages/${source.id}/forward`, {
                method: "POST",
                body: { conversation_ids: ids }
            });
            closeForwardModal();
            deps.toast(`Forwarded to ${ids.length} chat${ids.length === 1 ? "" : "s"}.`);
            exitSelectMode();
        } catch (error) {
            deps.toast(error.message, "error");
        }
    }

    async function loadPinned() {
        if (!deps.state.activeConversation) return;
        try {
            const payload = await deps.api(`/api/conversations/${deps.state.activeConversation.id}/pin`);
            deps.state.pinnedMessage = payload.pinned;
            renderPinned();
        } catch {
            deps.state.pinnedMessage = null;
            renderPinned();
        }
    }

    function renderPinned() {
        const pin = deps.state.pinnedMessage;
        if (!pin?.message) {
            ui.pinnedBar?.classList.add("hidden");
            return;
        }
        ui.pinnedBar?.classList.remove("hidden");
        if (ui.pinnedText) {
            const preview = pin.message.body
                || pin.message.attachment?.original_filename
                || "Pinned message";
            ui.pinnedText.textContent = preview;
        }
    }

    function jumpToPinned() {
        const id = deps.state.pinnedMessage?.message?.id;
        if (!id) return;
        const row = document.querySelector(`[data-message-id="${id}"]`);
        row?.scrollIntoView({ behavior: "smooth", block: "center" });
        row?.classList.add("is-selected");
        window.setTimeout(() => row?.classList.remove("is-selected"), 1200);
    }

    async function pinMessage(message) {
        if (!deps.state.activeConversation) return;
        try {
            const payload = await deps.api(`/api/conversations/${deps.state.activeConversation.id}/pin`, {
                method: "PUT",
                body: { message_id: message.id }
            });
            deps.state.pinnedMessage = payload.pinned;
            renderPinned();
            deps.toast("Message pinned.");
            deps.closeMessageContextMenu?.();
        } catch (error) {
            deps.toast(error.message, "error");
        }
    }

    async function unpinMessage() {
        if (!deps.state.activeConversation) return;
        try {
            await deps.api(`/api/conversations/${deps.state.activeConversation.id}/pin`, { method: "DELETE" });
            deps.state.pinnedMessage = null;
            renderPinned();
        } catch (error) {
            deps.toast(error.message, "error");
        }
    }

    function enterSelectMode(messageId) {
        deps.state.selectMode = true;
        if (!deps.state.selectedMessages) deps.state.selectedMessages = new Set();
        deps.state.selectedMessages.add(messageId);
        updateSelectionToolbar();
        deps.renderMessages();
    }

    function exitSelectMode() {
        deps.state.selectMode = false;
        deps.state.selectedMessages = new Set();
        ui.selectionToolbar?.classList.add("hidden");
        deps.renderMessages();
    }

    function toggleSelectMessage(messageId) {
        if (!deps.state.selectedMessages) deps.state.selectedMessages = new Set();
        if (deps.state.selectedMessages.has(messageId)) deps.state.selectedMessages.delete(messageId);
        else deps.state.selectedMessages.add(messageId);
        if (!deps.state.selectedMessages.size) exitSelectMode();
        else updateSelectionToolbar();
        deps.renderMessages();
    }

    function updateSelectionToolbar() {
        const count = deps.state.selectedMessages?.size || 0;
        ui.selectionToolbar?.classList.toggle("hidden", !count);
        if (ui.selectionCount) ui.selectionCount.textContent = `${count} selected`;
    }

    function openDeleteForSelection() {
        const id = [...(deps.state.selectedMessages || [])][0];
        const message = deps.state.messages.find((item) => item.id === id);
        if (message) openDeleteModal(message);
    }

    function openForwardForSelection() {
        const messages = deps.state.messages.filter((item) => deps.state.selectedMessages?.has(item.id));
        if (messages.length) openForwardModal(messages);
    }

    async function copySelected() {
        const messages = deps.state.messages.filter((item) => deps.state.selectedMessages?.has(item.id));
        const text = messages.map((item) => item.body).filter(Boolean).join("\n\n");
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            deps.toast("Copied.");
            exitSelectMode();
        } catch {
            deps.toast("Copy failed.", "error");
        }
    }

    function openLightbox(src, alt = "") {
        if (!ui.lightbox) return;
        previousLightboxFocus = document.activeElement;
        ui.lightbox.classList.remove("hidden");
        ui.lightbox.tabIndex = -1;
        const img = ui.lightbox.querySelector("img");
        if (img) {
            img.src = src;
            img.alt = alt;
        }
        ui.lightbox.focus({ preventScroll: true });
    }

    function closeLightbox() {
        ui.lightbox?.classList.add("hidden");
        previousLightboxFocus?.focus?.({ preventScroll: true });
        previousLightboxFocus = null;
    }

    function updateSearchNav() {
        const query = deps.elements.messageSearchInput?.value.trim();
        const matches = document.querySelectorAll(".search-highlight");
        ui.searchNav?.classList.toggle("hidden", !query || !matches.length);
        if (!query || !matches.length) {
            deps.state.searchMatchIndex = 0;
            return;
        }
        if (deps.state.searchMatchIndex == null || deps.state.searchMatchIndex >= matches.length) {
            deps.state.searchMatchIndex = 0;
        }
        document.querySelectorAll(".search-match-active").forEach((node) => {
            node.classList.remove("search-match-active");
        });
        const active = matches[deps.state.searchMatchIndex];
        active?.closest(".message-row")?.classList.add("search-match-active");
        active?.closest(".message-row")?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (ui.searchCount) {
            ui.searchCount.textContent = `${deps.state.searchMatchIndex + 1} / ${matches.length}`;
        }
    }

    function navigateSearch(direction) {
        const total = document.querySelectorAll(".search-highlight").length;
        if (!total) return;
        deps.state.searchMatchIndex = (deps.state.searchMatchIndex + direction + total) % total;
        updateSearchNav();
    }

    function applySocketReaction(payload) {
        const message = deps.state.messages.find((item) => item.id === payload.message_id);
        if (message) {
            message.reactions = payload.reactions;
            deps.renderMessages();
        }
    }

    function applySocketEdit(payload) {
        const message = deps.state.messages.find((item) => item.id === payload.id);
        if (message) Object.assign(message, payload);
        deps.renderMessages();
    }

    function applySocketPinned(payload) {
        if (deps.state.activeConversation?.id === payload.conversation_id) {
            deps.state.pinnedMessage = payload.pinned;
            renderPinned();
        }
    }

    function applySocketUnpinned(payload) {
        if (deps.state.activeConversation?.id === payload.conversation_id) {
            deps.state.pinnedMessage = null;
            renderPinned();
        }
    }

    async function retryMessage(message) {
        if (!message.body || !deps.state.activeConversation) return;
        message.client_status = "retrying";
        deps.renderMessages();
        try {
            const payload = await deps.api(`/api/conversations/${deps.state.activeConversation.id}/messages`, {
                method: "POST",
                body: { body: message.body }
            });
            const index = deps.state.messages.findIndex((item) => item.id === message.id);
            if (index >= 0) deps.state.messages[index] = payload.message;
            deps.renderMessages();
        } catch (error) {
            message.client_status = "failed";
            deps.renderMessages();
            deps.toast(error.message, "error");
        }
    }

    function handleContextAction(action) {
        const message = deps.state.contextMessage;
        if (!message) return;
        if (action === "react") {
            showReactionPicker(
                { clientX: Number(elementsFromMenu()?.left) || window.innerWidth / 2, clientY: Number(elementsFromMenu()?.top) || 120 },
                message
            );
        }
        if (action === "edit") {
            const row = document.querySelector(`[data-message-id="${message.id}"]`);
            if (row) startEdit(message, row);
        }
        if (action === "forward") openForwardModal([message]);
        if (action === "pin") pinMessage(message);
        if (action === "delete") openDeleteModal(message);
        if (action !== "react") deps.closeMessageContextMenu?.();
    }

    function elementsFromMenu() {
        const menu = document.querySelector("#messageContextMenu");
        if (!menu || menu.classList.contains("hidden")) return null;
        return { left: parseFloat(menu.style.left) || 0, top: parseFloat(menu.style.top) || 0 };
    }

    function updateContextMenuVisibility(message) {
        const menu = document.querySelector("#messageContextMenu");
        if (!menu || !message) return;
        const mine = message.sender.id === deps.currentUserId;
        const serverBacked = !message.client_id;
        menu.querySelector('[data-action="edit"]')?.classList.toggle("hidden", !serverBacked || !mine || message.is_deleted);
        menu.querySelector('[data-action="delete"]')?.classList.toggle("hidden", !serverBacked);
        menu.querySelector('[data-action="react"]')?.classList.toggle("hidden", message.is_deleted);
        menu.querySelector('[data-action="forward"]')?.classList.toggle("hidden", !serverBacked || message.is_deleted);
        menu.querySelector('[data-action="pin"]')?.classList.toggle("hidden", !serverBacked || message.is_deleted);
    }

    function destroy() {
        window.clearTimeout(reactionHideTimer);
        previousLightboxFocus = null;
        ui.reactionPicker?.classList.add("hidden");
        ui.reactionPicker?.classList.remove("is-open");
    }

    window.ChatMessaging = {
        init,
        destroy,
        enhanceMessageRow,
        loadPinned,
        renderPinned,
        openDeleteModal,
        showReactionPicker,
        hideReactionPicker,
        handleContextAction,
        updateContextMenuVisibility,
        applySocketReaction,
        applySocketEdit,
        applySocketPinned,
        applySocketUnpinned,
        updateSearchNav,
        enterSelectMode,
        toggleSelectMessage,
        exitSelectMode
    };
})();
