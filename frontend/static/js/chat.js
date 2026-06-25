const { $, $$, api, toast, readRecentSearches: loadRecentSearches, saveRecentSearch: persistRecentSearch, readMessageSide, writeMessageSide, readDarkMode, writeDarkMode } = window.AppUtils;

const state = {
    currentUser: null,
    friends: [],
    conversations: [],
    messages: [],
    activeConversation: null,
    requests: { received: [], sent: [] },
    recentConversationSearches: loadRecentSearches("conversation"),
    recentUserSearches: loadRecentSearches("user"),
    replyTo: null,
    contextMessage: null,
    scrollPositions: {},
    messageWindowStarts: {},
    unreadBoundaryCount: 0,
    typingTimer: null,
    userSearchTimer: null,
    socketReady: false,
    connectionLost: false,
    messageSide: readMessageSide(),
    selectMode: false,
    selectedMessages: new Set(),
    pinnedMessage: null,
    searchMatchIndex: 0,
    forwardMessages: [],
    unreadBelowCount: 0,
    scrollDateTimer: null,
    scrollDateFrame: null,
    floatingDateIndicator: null
};

state.messageWindowStart = 0;

const csrfToken = window.AppConfig?.csrfToken || "";
const currentUserId = window.AppConfig?.currentUserId;
const socket = window.io ? io() : null;
const MESSAGE_WINDOW_SIZE = 180;
const MESSAGE_WINDOW_STEP = 90;

let renderMessagesFrame = null;

function scheduleRenderMessages(options = {}) {
    if (renderMessagesFrame) return;
    renderMessagesFrame = requestAnimationFrame(() => {
        renderMessagesFrame = null;
        renderMessages(options);
    });
}

const elements = {
    sidebar: $("#sidebar"),
    panelTitle: $("#panelTitle"),
    conversationList: $("#conversationList"),
    conversationFilter: $("#conversationFilter"),
    conversationSearchClear: $("#conversationSearchClear"),
    conversationSearchMeta: $("#conversationSearchMeta"),
    conversationRecentSearches: $("#conversationRecentSearches"),
    userSearchInput: $("#userSearchInput"),
    userSearchClear: $("#userSearchClear"),
    userSearchMeta: $("#userSearchMeta"),
    userRecentSearches: $("#userRecentSearches"),
    userSearchResults: $("#userSearchResults"),
    requestList: $("#requestList"),
    friendList: $("#friendList"),
    groupFriendChoices: $("#groupFriendChoices"),
    createGroupForm: $("#createGroupForm"),
    groupName: $("#groupName"),
    groupDescription: $("#groupDescription"),
    emptyState: $("#emptyState"),
    chatView: $("#chatView"),
    chatAvatar: $("#chatAvatar"),
    chatTitle: $("#chatTitle"),
    chatStatus: $("#chatStatus"),
    groupInfoBtn: $("#groupInfoBtn"),
    messageList: $("#messageList"),
    jumpLatestBtn: $("#jumpLatestBtn"),
    messageForm: $("#messageForm"),
    messageInput: $("#messageInput"),
    messageSearchToggle: $("#messageSearchToggle"),
    messageSearchBar: $("#messageSearchBar"),
    messageSearchInput: $("#messageSearchInput"),
    messageSearchClear: $("#messageSearchClear"),
    messageSearchMeta: $("#messageSearchMeta"),
    typingIndicator: $("#typingIndicator"),
    replyPreview: $("#replyPreview"),
    replyPreviewTitle: $("#replyPreviewTitle"),
    replyPreviewText: $("#replyPreviewText"),
    replyCancelBtn: $("#replyCancelBtn"),
    attachmentInput: $("#attachmentInput"),
    attachmentBtn: $("#attachmentBtn"),
    attachmentChip: $("#attachmentChip"),
    emojiBtn: $("#emojiBtn"),
    emojiTray: $("#emojiTray"),
    mobileBackBtn: $("#mobileBackBtn"),
    darkModeToggle: $("#darkModeToggle"),
    darkModeCheckbox: $("#darkModeCheckbox"),
    settingsAvatar: $("#settingsAvatar"),
    settingsName: $("#settingsName"),
    settingsUsername: $("#settingsUsername"),
    toastStack: $("#toastStack"),
    drawerScrim: $("#drawerScrim"),
    groupDrawer: $("#groupDrawer"),
    drawerCloseBtn: $("#drawerCloseBtn"),
    drawerTitle: $("#drawerTitle"),
    drawerDescription: $("#drawerDescription"),
    drawerMembers: $("#drawerMembers"),
    drawerFriendChoices: $("#drawerFriendChoices"),
    addMembersForm: $("#addMembersForm"),
    messageContextMenu: $("#messageContextMenu")
};

function saveRecentSearch(type, query) {
    const existing = type === "conversation" ? state.recentConversationSearches : state.recentUserSearches;
    const next = persistRecentSearch(type, query, existing);
    if (type === "conversation") state.recentConversationSearches = next;
    if (type === "user") state.recentUserSearches = next;
    return next;
}

function renderRecentSearches(container, searches, handler) {
    if (!container) return;
    container.replaceChildren();
    for (const query of searches) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "recent-chip";
        chip.textContent = query;
        chip.addEventListener("click", () => handler(query));
        container.appendChild(chip);
    }
}

function buildListLoading(count = 5) {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
        const row = document.createElement("div");
        row.className = "skeleton-row";
        const avatar = document.createElement("span");
        const lines = document.createElement("div");
        lines.append(document.createElement("i"), document.createElement("b"));
        row.append(avatar, lines);
        fragment.appendChild(row);
    }
    return fragment;
}

function buildMessageLoading() {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 4; index += 1) {
        const row = document.createElement("div");
        row.className = `message-row ${index % 2 ? "mine" : "theirs"} skeleton-message`;
        const bubble = document.createElement("div");
        bubble.className = "message-bubble";
        row.appendChild(bubble);
        fragment.appendChild(row);
    }
    return fragment;
}

function snippet(text = "", length = 70) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return "Attachment";
    return clean.length > length ? `${clean.slice(0, length - 1)}...` : clean;
}

function appendHighlightedText(node, text = "", query = "") {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
        node.appendChild(document.createTextNode(text));
        return;
    }
    const lowerText = text.toLowerCase();
    const lowerQuery = cleanQuery.toLowerCase();
    let cursor = 0;
    while (cursor < text.length) {
        const index = lowerText.indexOf(lowerQuery, cursor);
        if (index === -1) {
            node.appendChild(document.createTextNode(text.slice(cursor)));
            break;
        }
        if (index > cursor) {
            node.appendChild(document.createTextNode(text.slice(cursor, index)));
        }
        const mark = document.createElement("mark");
        mark.className = "search-highlight";
        mark.textContent = text.slice(index, index + cleanQuery.length);
        node.appendChild(mark);
        cursor = index + cleanQuery.length;
    }
}

const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,;:!?"')\]}])/gi;
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;
const EMOJI_PATTERN = /(\p{Extended_Pictographic})/gu;

function appendFormattedSegment(node, text = "", query = "") {
    if (!text) return;
    const parts = text.split(INLINE_CODE_PATTERN);
    for (let index = 0; index < parts.length; index += 1) {
        if (index % 2 === 1) {
            const code = document.createElement("code");
            code.className = "inline-code";
            appendHighlightedText(code, parts[index], query);
            node.appendChild(code);
            continue;
        }
        const chunk = parts[index];
        if (!chunk) continue;
        const emojiParts = chunk.split(EMOJI_PATTERN);
        for (const emojiPart of emojiParts) {
            if (!emojiPart) continue;
            if (/\p{Extended_Pictographic}/u.test(emojiPart)) {
                const emoji = document.createElement("span");
                emoji.className = "emoji-char";
                emoji.textContent = emojiPart;
                node.appendChild(emoji);
            } else {
                appendHighlightedText(node, emojiPart, query);
            }
        }
    }
}

function appendMessageBody(node, text = "", query = "") {
    if (!text) return;
    node.replaceChildren();
    let lastIndex = 0;
    const matcher = new RegExp(URL_PATTERN.source, "gi");
    let match = matcher.exec(text);
    while (match) {
        if (match.index > lastIndex) {
            appendFormattedSegment(node, text.slice(lastIndex, match.index), query);
        }
        const link = document.createElement("a");
        link.href = match[0];
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "message-link";
        link.textContent = match[0];
        node.appendChild(link);
        lastIndex = match.index + match[0].length;
        match = matcher.exec(text);
    }
    if (lastIndex < text.length) appendFormattedSegment(node, text.slice(lastIndex), query);
}

function canGroupMessages(previous, current) {
    if (!previous || !current) return false;
    if (previous.is_deleted || current.is_deleted) return false;
    if (previous.sender.id !== current.sender.id) return false;
    return !shouldShowTimeSeparator(previous, current);
}

function getMessageGroupPosition(messages, index) {
    const current = messages[index];
    const previous = index > 0 ? messages[index - 1] : null;
    const next = index < messages.length - 1 ? messages[index + 1] : null;
    const withPrevious = canGroupMessages(previous, current);
    const withNext = canGroupMessages(current, next);
    if (!withPrevious && !withNext) return "single";
    if (!withPrevious && withNext) return "start";
    if (withPrevious && withNext) return "middle";
    return "end";
}

function getWindowGroupPosition(messages, index, start, end) {
    const current = messages[index];
    const previous = index > start ? messages[index - 1] : null;
    const next = index < end - 1 ? messages[index + 1] : null;
    const withPrevious = canGroupMessages(previous, current);
    const withNext = canGroupMessages(current, next);
    if (!withPrevious && !withNext) return "single";
    if (!withPrevious && withNext) return "start";
    if (withPrevious && withNext) return "middle";
    return "end";
}

function shouldWindowMessages() {
    return !elements.messageSearchInput.value.trim() && state.messages.length > MESSAGE_WINDOW_SIZE;
}

function resetMessageWindow() {
    if (!shouldWindowMessages()) {
        state.messageWindowStart = 0;
        return;
    }
    const saved = state.messageWindowStarts[state.activeConversation?.id];
    const latestStart = Math.max(0, state.messages.length - MESSAGE_WINDOW_SIZE);
    state.messageWindowStart = typeof saved === "number"
        ? Math.max(0, Math.min(saved, latestStart))
        : latestStart;
}

function visibleMessageRange() {
    if (!shouldWindowMessages()) return { start: 0, end: state.messages.length };
    return {
        start: Math.max(0, Math.min(state.messageWindowStart, state.messages.length - 1)),
        end: state.messages.length
    };
}

function buildMessageWindowSentinel(hiddenCount) {
    const wrapper = document.createElement("div");
    wrapper.className = "message-window-sentinel";
    wrapper.setAttribute("role", "presentation");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Show ${Math.min(MESSAGE_WINDOW_STEP, hiddenCount)} earlier messages`;
    button.setAttribute("aria-label", `${hiddenCount} earlier messages hidden. Show more.`);
    button.addEventListener("click", () => {
        const previousHeight = elements.messageList.scrollHeight;
        state.messageWindowStart = Math.max(0, state.messageWindowStart - MESSAGE_WINDOW_STEP);
        renderMessages({ preserveScrollHeight: previousHeight });
    });
    wrapper.appendChild(button);
    return wrapper;
}

function replyBody(message) {
    if (!message) return "";
    if (message.is_deleted) return "This message was deleted";
    return snippet(message.body || message.attachment?.original_filename || "Attachment", 90);
}

function formatMessageSeparator(value) {
    const date = new Date(value);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (date.toDateString() === today.toDateString()) return `Today ${time}`;
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
    return `${date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} ${time}`;
}

function shouldShowTimeSeparator(previous, current) {
    if (!previous) return true;
    const previousDate = new Date(previous.created_at);
    const currentDate = new Date(current.created_at);
    const minutes = Math.abs(currentDate - previousDate) / 60000;
    return previousDate.toDateString() !== currentDate.toDateString() || minutes >= 5;
}

function parseReplyPrefix(body = "") {
    const match = body.match(/^\[Reply to ([^:]+): ([^\]]*)\]\n\n?([\s\S]*)$/);
    if (!match) return null;
    return {
        title: `Reply to ${match[1]}`,
        quote: match[2],
        body: match[3]
    };
}

function setDarkMode(enabled) {
    document.body.classList.toggle("dark", enabled);
    writeDarkMode(enabled);
    if (elements.darkModeCheckbox) elements.darkModeCheckbox.checked = enabled;
}

function initials(name = "") {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return (name || "?").slice(0, 2).toUpperCase();
}

function isFlippedMessageSide() {
    return state.messageSide === "sender";
}

function createAvatar(source, title, options = {}) {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    if (options.spacer) avatar.classList.add("avatar-spacer");
    if (options.online) avatar.classList.add("is-online");
    if (options.spacer) {
        avatar.setAttribute("aria-hidden", "true");
        return avatar;
    }
    avatar.dataset.initials = initials(title);
    avatar.title = title || "";
    if (source) {
        const img = document.createElement("img");
        img.src = source;
        img.alt = "";
        img.addEventListener("error", () => img.remove(), { once: true });
        avatar.appendChild(img);
    }
    return avatar;
}

function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatConversationTime(value) {
    if (!value) return "";
    const date = new Date(value);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return formatTime(value);
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    if (date.getFullYear() === today.getFullYear()) {
        return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "2-digit" });
}

function formatLastSeen(value) {
    if (!value) return "Offline";
    const date = new Date(value);
    return `Last seen ${date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
}

function displayAsMine(senderId) {
    const mine = senderId === currentUserId;
    return isFlippedMessageSide() ? !mine : mine;
}

function setMessageSide(side) {
    state.messageSide = writeMessageSide(side);
    syncMessageSideUI();
    renderConversations();
    if (state.activeConversation) renderMessages();
}

function syncMessageSideUI() {
    document.querySelectorAll("[data-side-toggle] .side-toggle-btn").forEach((button) => {
        const active = button.dataset.side === state.messageSide;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    document.querySelectorAll("[data-auth-preview]").forEach((preview) => {
        preview.classList.toggle("flip-sides", isFlippedMessageSide());
    });
}

function setupInteractiveFeedback() {
    const pressSelector = ".surface-card-interactive, .primary-btn, .send-btn, .small-btn";
    document.addEventListener("pointerdown", (event) => {
        const target = event.target.closest(pressSelector);
        if (target) target.classList.add("is-pressed");
    });
    document.addEventListener("pointerup", () => {
        document.querySelectorAll(`${pressSelector}.is-pressed`).forEach((node) => node.classList.remove("is-pressed"));
    });
    document.addEventListener("pointercancel", () => {
        document.querySelectorAll(`${pressSelector}.is-pressed`).forEach((node) => node.classList.remove("is-pressed"));
    });
}

function setupMessageSideToggles() {
    document.querySelectorAll("[data-side-toggle]").forEach((group) => {
        group.querySelectorAll(".side-toggle-btn").forEach((button) => {
            button.addEventListener("click", () => setMessageSide(button.dataset.side));
        });
    });
    syncMessageSideUI();
}

function lastMessagePreview(message) {
    if (!message) return "No messages yet";
    if (message.is_deleted || message.message_type === "deleted") return "This message was deleted";
    if (message.message_type === "image") return message.body ? `Photo: ${message.body}` : "Photo";
    if (message.message_type === "document") return `File: ${message.attachment?.original_filename || "Document"}`;
    return message.body || "Message";
}

function formatFileSize(bytes = 0) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function fileExtensionLabel(filename = "") {
    const extension = filename.split(".").pop()?.trim();
    if (!extension || extension === filename) return "FILE";
    return extension.slice(0, 4).toUpperCase();
}

function buildAttachmentPreview(message) {
    const attachment = message.attachment;
    const filename = attachment.original_filename || "Attachment";
    const mimetype = attachment.mimetype || "Document";
    const link = document.createElement("a");
    link.href = `/api/attachments/${attachment.id}/download`;
    link.target = "_blank";
    link.rel = "noopener";

    if (message.message_type === "image") {
        link.className = "attachment-preview image-preview attachment-card";
        link.setAttribute("aria-label", `Open image ${filename}`);
        link.title = filename;
        const img = document.createElement("img");
        img.className = "chat-image";
        img.alt = filename;
        img.loading = "lazy";
        img.decoding = "async";
        img.addEventListener("load", () => link.classList.add("attachment-loaded"), { once: true });
        img.addEventListener("error", () => link.classList.add("attachment-error"));
        img.src = attachment.url;
        const caption = document.createElement("span");
        caption.className = "attachment-caption";
        caption.textContent = filename;
        link.append(img, caption);
        return link;
    }

    link.className = "file-card attachment-card";
    link.setAttribute("aria-label", `Download ${filename}`);
    link.title = filename;
    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.textContent = fileExtensionLabel(filename);
    const text = document.createElement("span");
    text.className = "file-meta";
    const name = document.createElement("strong");
    name.textContent = filename;
    const detail = document.createElement("small");
    const size = formatFileSize(attachment.file_size);
    detail.textContent = size ? `${mimetype} · ${size}` : mimetype;
    text.append(name, detail);
    link.append(icon, text);
    return link;
}

function messageStatusLabel(message) {
    if (!message || message.sender.id !== currentUserId) return "";
    if (message.status === "seen") return "Seen";
    if (message.status === "delivered") return "Delivered";
    return "Sent";
}

function upsertConversation(conversation) {
    const index = state.conversations.findIndex((item) => item.id === conversation.id);
    if (index >= 0) {
        state.conversations[index] = { ...state.conversations[index], ...conversation };
    } else {
        state.conversations.unshift(conversation);
    }
    state.conversations.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
}

function setPanel(panelId) {
    const titles = {
        conversationsPanel: "Chats",
        friendsPanel: "Contacts",
        groupsPanel: "Groups",
        settingsPanel: "Me"
    };
    if (elements.panelTitle) elements.panelTitle.textContent = titles[panelId] || "Chats";
    $$(".tab-btn").forEach((button) => button.classList.toggle("active", button.dataset.panel === panelId));
    $$(".side-panel").forEach((panel) => panel.classList.toggle("active", panel.id === panelId));
}

function buildListEmpty(text) {
    const empty = document.createElement("div");
    empty.className = "list-empty empty-state-card";
    empty.setAttribute("role", "status");
    const mark = document.createElement("span");
    mark.className = "empty-mini-mark";
    mark.textContent = "W";
    const copy = document.createElement("span");
    copy.textContent = text;
    empty.append(mark, copy);
    return empty;
}

function buildMessageEmpty(isSearch) {
    const empty = document.createElement("div");
    empty.className = "message-empty-state empty-state-card";
    empty.setAttribute("role", "status");
    const mark = document.createElement("span");
    mark.className = "empty-mini-mark";
    mark.textContent = isSearch ? "Search" : "Chat";
    const title = document.createElement("strong");
    title.textContent = isSearch ? "No matching messages" : "No messages yet";
    const copy = document.createElement("span");
    copy.textContent = isSearch ? "Try a different keyword or clear search." : "Send the first message to start the conversation.";
    empty.append(mark, title, copy);
    return empty;
}

function renderSettings() {
    if (!state.currentUser) return;
    elements.settingsAvatar.replaceChildren(createAvatar(state.currentUser.profile_photo, state.currentUser.display_name));
    elements.settingsName.textContent = state.currentUser.display_name;
    elements.settingsUsername.textContent = `@${state.currentUser.username}`;
}

function renderConversations() {
    const rawQuery = elements.conversationFilter.value || "";
    const query = rawQuery.toLowerCase().trim();
    elements.conversationList.replaceChildren();
    renderRecentSearches(elements.conversationRecentSearches, state.recentConversationSearches, (value) => {
        elements.conversationFilter.value = value;
        renderConversations();
    });
    const conversations = state.conversations.filter((conversation) =>
        conversation.title.toLowerCase().includes(query) ||
        lastMessagePreview(conversation.last_message).toLowerCase().includes(query)
    );
    if (elements.conversationSearchMeta) {
        elements.conversationSearchMeta.textContent = query
            ? `${conversations.length} result${conversations.length === 1 ? "" : "s"} for "${rawQuery.trim()}"`
            : `${state.conversations.length} conversation${state.conversations.length === 1 ? "" : "s"}`;
    }

    if (!conversations.length) {
        elements.conversationList.appendChild(buildListEmpty(query ? "No matching chats." : "No chats yet."));
        return;
    }

    if (query) saveRecentSearch("conversation", rawQuery);

    for (const conversation of conversations) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "conversation-item surface-card-interactive";
        button.setAttribute("aria-label", `Open chat with ${conversation.title}`);
        button.classList.toggle("is-active", state.activeConversation?.id === conversation.id);
        button.classList.toggle("active", state.activeConversation?.id === conversation.id);
        button.classList.toggle("has-unread", conversation.unread_count > 0);
        button.classList.toggle("is-online", conversation.type === "direct" && Boolean(conversation.other_user?.is_online));
        button.classList.toggle("is-offline", conversation.type === "direct" && !conversation.other_user?.is_online);
        if (state.activeConversation?.id === conversation.id) {
            button.setAttribute("aria-current", "true");
        }
        button.appendChild(createAvatar(conversation.photo, conversation.title, {
            online: conversation.type === "direct" && Boolean(conversation.other_user?.is_online)
        }));

        const main = document.createElement("div");
        main.className = "item-main";
        const titleRow = document.createElement("div");
        titleRow.className = "conversation-title-row";
        const title = document.createElement("div");
        title.className = "item-title";
        appendHighlightedText(title, conversation.title, rawQuery);
        const time = document.createElement("time");
        time.className = "conversation-time";
        time.dateTime = conversation.last_message_at || "";
        time.textContent = formatConversationTime(conversation.last_message_at);
        titleRow.append(title, time);

        const previewRow = document.createElement("div");
        previewRow.className = "conversation-preview-row";
        const fromMe = conversation.last_message?.sender?.id === currentUserId;
        const previewBubble = document.createElement("div");
        previewBubble.className = `conversation-preview-bubble ${displayAsMine(conversation.last_message?.sender?.id) ? "mine" : "theirs"}`;
        previewBubble.classList.toggle("has-attachment", Boolean(conversation.last_message?.attachment));
        const previewText = fromMe ? `You: ${lastMessagePreview(conversation.last_message)}` : lastMessagePreview(conversation.last_message);
        appendHighlightedText(previewBubble, previewText, rawQuery);
        previewRow.appendChild(previewBubble);

        if (conversation.unread_count > 0) {
            const unread = document.createElement("span");
            unread.className = "unread-badge";
            unread.textContent = conversation.unread_count;
            unread.setAttribute("aria-label", `${conversation.unread_count} unread messages`);
            previewRow.appendChild(unread);
        }

        main.append(titleRow, previewRow);
        button.append(main);
        button.addEventListener("click", () => openConversation(conversation.id));
        elements.conversationList.appendChild(button);
    }
}

function renderRequests() {
    elements.requestList.replaceChildren();
    const received = state.requests.received || [];
    const sent = state.requests.sent || [];

    if (!received.length && !sent.length) {
        elements.requestList.appendChild(buildListEmpty("No pending requests."));
        return;
    }

    for (const request of received) {
        const row = buildUserRow(request.sender, {
            subtitle: "Wants to connect",
            actions: [
                ["Accept", "small-btn", () => respondToRequest(request.id, "accept")],
                ["Reject", "small-btn danger", () => respondToRequest(request.id, "reject")]
            ]
        });
        elements.requestList.appendChild(row);
    }

    for (const request of sent) {
        const row = buildUserRow(request.receiver, {
            subtitle: "Request sent",
            badge: "Pending"
        });
        elements.requestList.appendChild(row);
    }
}

function renderFriends() {
    elements.friendList.replaceChildren();
    if (!state.friends.length) {
        elements.friendList.appendChild(buildListEmpty("No friends added."));
    }

    for (const friend of state.friends) {
        const row = buildUserRow(friend, {
            subtitle: friend.is_online ? "Online" : formatLastSeen(friend.last_seen),
            actions: [
                ["Message", "small-btn", () => startDirectConversation(friend.id)],
                ["Remove", "small-btn danger", () => removeFriend(friend.id)]
            ]
        });
        elements.friendList.appendChild(row);
    }

    renderGroupFriendChoices();
}

function renderGroupFriendChoices() {
    elements.groupFriendChoices.replaceChildren();
    if (!state.friends.length) {
        elements.groupFriendChoices.appendChild(buildListEmpty("Add friends first."));
        return;
    }

    for (const friend of state.friends) {
        const label = document.createElement("label");
        label.className = "check-row";
        const span = document.createElement("span");
        span.textContent = friend.display_name;
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = friend.id;
        label.append(span, input);
        elements.groupFriendChoices.appendChild(label);
    }
}

function buildUserRow(user, options = {}) {
    const row = document.createElement("div");
    row.className = "list-item surface-card-interactive";
    row.appendChild(createAvatar(user.profile_photo, user.display_name));

    const main = document.createElement("div");
    main.className = "item-main";
    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = user.display_name;
    const subtitle = document.createElement("div");
    subtitle.className = "item-subtitle";
    subtitle.textContent = options.subtitle || `@${user.username}`;
    main.append(title, subtitle);

    const actions = document.createElement("div");
    actions.className = "item-actions";
    if (options.badge) {
        const badge = document.createElement("span");
        badge.className = "status-pill";
        badge.textContent = options.badge;
        actions.appendChild(badge);
    }
    for (const [label, className, handler] of options.actions || []) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.textContent = label;
        button.setAttribute("aria-label", `${label} ${user.display_name}`);
        button.addEventListener("click", handler);
        actions.appendChild(button);
    }

    row.append(main, actions);
    return row;
}

function renderUserSearch(users) {
    elements.userSearchResults.replaceChildren();
    const query = elements.userSearchInput.value.trim();
    if (elements.userSearchMeta) {
        elements.userSearchMeta.textContent = query
            ? `${users.length} result${users.length === 1 ? "" : "s"} for "${query}"`
            : "Type at least 2 characters to find users.";
    }
    renderRecentSearches(elements.userRecentSearches, state.recentUserSearches, (value) => {
        elements.userSearchInput.value = value;
        elements.userSearchInput.dispatchEvent(new Event("input"));
    });
    if (!users.length) {
        elements.userSearchResults.appendChild(buildListEmpty(query ? "No users found." : "Search by username or display name."));
        return;
    }

    saveRecentSearch("user", query);

    for (const user of users) {
        let options;
        if (user.is_friend) {
            options = { subtitle: `@${user.username}`, actions: [["Message", "small-btn", () => startDirectConversation(user.id)]] };
        } else if (user.request_status === "pending") {
            options = { subtitle: `@${user.username}`, badge: "Pending" };
        } else {
            options = { subtitle: `@${user.username}`, actions: [["Add", "small-btn", () => sendFriendRequest(user.id)]] };
        }
        elements.userSearchResults.appendChild(buildUserRow(user, options));
    }
}

async function loadBootstrap() {
    elements.conversationList.setAttribute("aria-busy", "true");
    elements.friendList.setAttribute("aria-busy", "true");
    elements.requestList.setAttribute("aria-busy", "true");
    elements.conversationList.replaceChildren(buildListLoading(6));
    elements.friendList.replaceChildren(buildListLoading(4));
    elements.requestList.replaceChildren(buildListLoading(2));
    renderRecentSearches(elements.conversationRecentSearches, state.recentConversationSearches, (value) => {
        elements.conversationFilter.value = value;
        renderConversations();
    });
    renderRecentSearches(elements.userRecentSearches, state.recentUserSearches, (value) => {
        elements.userSearchInput.value = value;
        elements.userSearchInput.dispatchEvent(new Event("input"));
    });
    try {
        const [bootstrap, requests] = await Promise.all([
            api("/api/bootstrap"),
            api("/api/friends/requests")
        ]);
        state.currentUser = bootstrap.current_user;
        state.friends = bootstrap.friends;
        state.conversations = bootstrap.conversations;
        state.requests = requests;
        renderSettings();
        renderConversations();
        renderFriends();
        renderRequests();
        elements.conversationList.setAttribute("aria-busy", "false");
        elements.friendList.setAttribute("aria-busy", "false");
        elements.requestList.setAttribute("aria-busy", "false");
    } catch (error) {
        elements.conversationList.replaceChildren(buildListEmpty("Could not load chats. Please refresh."));
        elements.friendList.replaceChildren(buildListEmpty("Could not load contacts."));
        elements.requestList.replaceChildren(buildListEmpty("Could not load requests."));
        elements.conversationList.setAttribute("aria-busy", "false");
        elements.friendList.setAttribute("aria-busy", "false");
        elements.requestList.setAttribute("aria-busy", "false");
        toast(error.message, "error");
    }
}

async function refreshConversations() {
    try {
        const payload = await api("/api/conversations");
        state.conversations = payload.conversations;
        renderConversations();
    } catch (error) {
        elements.messageList.replaceChildren(buildListEmpty("Messages could not load. Please try again."));
        if (elements.messageSearchMeta) elements.messageSearchMeta.textContent = "";
        toast(error.message, "error");
    }
}

async function refreshFriendsAndRequests() {
    try {
        const [friends, requests] = await Promise.all([
            api("/api/friends"),
            api("/api/friends/requests")
        ]);
        state.friends = friends.friends;
        state.requests = requests;
        renderFriends();
        renderRequests();
    } catch (error) {
        toast(error.message, "error");
    }
}

async function startDirectConversation(userId) {
    try {
        const payload = await api("/api/conversations/direct", {
            method: "POST",
            body: { user_id: userId }
        });
        upsertConversation(payload.conversation);
        renderConversations();
        openConversation(payload.conversation.id);
        setPanel("conversationsPanel");
    } catch (error) {
        toast(error.message, "error");
    }
}

async function sendFriendRequest(userId) {
    try {
        await api("/api/friends/request", {
            method: "POST",
            body: { user_id: userId }
        });
        toast("Friend request sent.");
        elements.userSearchInput.dispatchEvent(new Event("input"));
        refreshFriendsAndRequests();
    } catch (error) {
        toast(error.message, "error");
    }
}

async function respondToRequest(requestId, action) {
    try {
        await api(`/api/friends/requests/${requestId}/${action}`, { method: "POST" });
        await refreshFriendsAndRequests();
        toast(action === "accept" ? "Friend request accepted." : "Friend request rejected.");
    } catch (error) {
        toast(error.message, "error");
    }
}

async function removeFriend(friendId) {
    if (!confirm("Remove this friend?")) return;
    try {
        await api(`/api/friends/${friendId}`, { method: "DELETE" });
        await refreshFriendsAndRequests();
        await refreshConversations();
    } catch (error) {
        toast(error.message, "error");
    }
}

async function openConversation(conversationId) {
    const conversation = state.conversations.find((item) => item.id === conversationId);
    if (!conversation) return;

    saveActiveScrollPosition();
    state.unreadBoundaryCount = conversation.unread_count || 0;
    state.activeConversation = conversation;
    conversation.unread_count = 0;
    elements.emptyState.classList.add("hidden");
    elements.chatView.classList.remove("hidden");
    document.body.classList.add("chat-open");
    elements.chatAvatar.replaceChildren(createAvatar(conversation.photo, conversation.title));
    elements.chatTitle.textContent = conversation.title;
    elements.groupInfoBtn.classList.toggle("hidden", conversation.type !== "group");
    updateChatStatus(conversation);
    renderConversations();

    if (socket) socket.emit("join_conversation", { conversation_id: conversation.id });
    await loadMessages();
    await window.ChatMessaging?.loadPinned();
    markConversationRead();
}

function updateChatStatus(conversation) {
    if (conversation.type === "group") {
        const count = conversation.group?.member_count || "";
        elements.chatStatus.textContent = count ? `${count} members` : "Group chat";
        return;
    }
    const other = conversation.other_user;
    elements.chatStatus.textContent = other?.is_online ? "Online" : formatLastSeen(other?.last_seen);
}

async function loadMessages(query = "") {
    if (!state.activeConversation) return;
    state.unreadBelowCount = 0;
    state.floatingDateIndicator?.classList.add("hidden");
    elements.messageList.setAttribute("aria-busy", "true");
    elements.messageList.replaceChildren(buildMessageLoading());
    elements.jumpLatestBtn?.classList.add("hidden");
    if (elements.messageSearchMeta) {
        elements.messageSearchMeta.textContent = query ? `Searching for "${query}"...` : "";
    }
    try {
        const suffix = query ? `?q=${encodeURIComponent(query)}` : "";
        const payload = await api(`/api/conversations/${state.activeConversation.id}/messages${suffix}`);
        state.messages = payload.messages;
        resetMessageWindow();
        renderMessages();
        elements.messageList.setAttribute("aria-busy", "false");
        if (elements.messageSearchMeta) {
            elements.messageSearchMeta.textContent = query
                ? `${state.messages.length} message${state.messages.length === 1 ? "" : "s"} found`
                : "";
        }
        settleMessageScroll(query);
    } catch (error) {
        elements.messageList.replaceChildren(buildListEmpty("Messages could not load. Please try again."));
        elements.messageList.setAttribute("aria-busy", "false");
        if (elements.messageSearchMeta) elements.messageSearchMeta.textContent = "";
        toast(error.message, "error");
    }
}

function renderMessages(options = {}) {
    const previousScrollHeight = options.preserveScrollHeight || 0;
    elements.messageList.replaceChildren();
    if (!state.messages.length) {
        state.floatingDateIndicator?.classList.add("hidden");
        elements.messageList.appendChild(buildMessageEmpty(Boolean(elements.messageSearchInput.value.trim())));
        return;
    }
    let previous = null;
    const showUnread = !elements.messageSearchInput.value.trim() && state.unreadBoundaryCount > 0;
    const unreadStartIndex = showUnread ? Math.max(0, state.messages.length - state.unreadBoundaryCount) : -1;
    const { start, end } = visibleMessageRange();
    if (start > 0) {
        elements.messageList.appendChild(buildMessageWindowSentinel(start));
    }
    for (let index = start; index < end; index += 1) {
        const message = state.messages[index];
        if (shouldShowTimeSeparator(previous, message)) {
            const divider = document.createElement("div");
            divider.className = "message-time-separator";
            divider.setAttribute("role", "separator");
            divider.textContent = formatMessageSeparator(message.created_at);
            elements.messageList.appendChild(divider);
        }
        if (index === unreadStartIndex) {
            const unread = document.createElement("div");
            unread.className = "unread-separator";
            unread.setAttribute("role", "separator");
            unread.textContent = "Unread messages";
            elements.messageList.appendChild(unread);
        }
        const groupPosition = getWindowGroupPosition(state.messages, index, start, end);
        elements.messageList.appendChild(renderMessage(message, {
            groupPosition,
            isNew: options.animateMessageId === message.id
        }));
        previous = message;
    }
    if (previousScrollHeight) {
        elements.messageList.scrollTop += elements.messageList.scrollHeight - previousScrollHeight;
    }
    window.ChatMessaging?.updateSearchNav();
    updateFloatingDateIndicator();
}

function patchMessageStatus(messageId, updates) {
    const row = elements.messageList?.querySelector(`[data-message-id="${messageId}"]`);
    if (!row) return false;
    const statusNode = row.querySelector(".message-status:not([data-client])");
    if (!statusNode || !updates.status) return false;
    statusNode.dataset.status = updates.status;
    statusNode.textContent = messageStatusLabel({ sender: { id: currentUserId }, status: updates.status });
    statusNode.setAttribute("aria-label", `Message ${updates.status}`);
    statusNode.title = `Message ${updates.status}`;
    statusNode.classList.add("is-receipt-updated");
    window.setTimeout(() => statusNode.classList.remove("is-receipt-updated"), 520);
    return true;
}

function patchMessageStatuses(messageIds, status, readAt) {
    let patched = 0;
    for (const messageId of messageIds) {
        const message = state.messages.find((item) => item.id === messageId);
        if (message) {
            message.status = status;
            if (readAt) message.read_at = readAt;
        }
        if (patchMessageStatus(messageId, { status })) patched += 1;
    }
    if (!patched) scheduleRenderMessages();
}

function appendMessageToList(message, options = {}) {
    if (shouldWindowMessages()) {
        resetMessageWindow();
        renderMessages(options);
        return;
    }
    const index = state.messages.length - 1;
    const previous = index > 0 ? state.messages[index - 1] : null;
    if (shouldShowTimeSeparator(previous, message)) {
        const divider = document.createElement("div");
        divider.className = "message-time-separator";
        divider.setAttribute("role", "separator");
        divider.textContent = formatMessageSeparator(message.created_at);
        elements.messageList.appendChild(divider);
    }
    const groupPosition = getMessageGroupPosition(state.messages, index);
    elements.messageList.appendChild(renderMessage(message, {
        groupPosition,
        isNew: options.animateMessageId === message.id
    }));
}

function renderMessage(message, context = {}) {
    const { groupPosition = "single", isNew = false } = context;
    const mine = message.sender.id === currentUserId;
    const displayMine = displayAsMine(message.sender.id);
    const row = document.createElement("div");
    row.className = `message-row ${displayMine ? "mine" : "theirs"} group-${groupPosition}`;
    row.dataset.messageId = message.id;
    row.dataset.createdAt = message.created_at || "";
    row.setAttribute("role", "listitem");
    row.setAttribute("aria-label", `${message.sender.display_name} at ${formatTime(message.created_at)}`);
    row.tabIndex = 0;
    if (isNew) row.classList.add("is-new");
    if (message.attachment) row.classList.add("has-attachment");
    if ((message.body || "").length > 520) row.classList.add("is-long");
    row.addEventListener("contextmenu", (event) => openMessageContextMenu(event, message));
    row.addEventListener("keydown", (event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            openMessageContextMenu(event, message);
        }
    });

    if (!displayMine) {
        const showAvatar = groupPosition === "end" || groupPosition === "single";
        row.appendChild(createAvatar(
            message.sender.profile_photo,
            message.sender.display_name,
            {
                spacer: !showAvatar,
                online: showAvatar && Boolean(message.sender.is_online)
            }
        ));
    }

    const bubble = document.createElement("div");
    const isMediaOnly = Boolean(message.attachment) && !message.body && !message.is_deleted;
    bubble.className = `message-bubble${isMediaOnly ? " message-bubble--media" : ""}`;
    if (isMediaOnly) row.classList.add("is-media-only");

    if (!displayMine && state.activeConversation?.type === "group" && (groupPosition === "start" || groupPosition === "single")) {
        const author = document.createElement("div");
        author.className = "message-author";
        author.textContent = message.sender.display_name;
        bubble.appendChild(author);
    }

    if (message.is_deleted || message.message_type === "deleted") {
        const deleted = document.createElement("div");
        deleted.className = "message-body message-deleted";
        deleted.textContent = "This message was deleted";
        bubble.appendChild(deleted);
    } else {
        if (message.attachment) {
            bubble.appendChild(buildAttachmentPreview(message));
        }

        if (message.body) {
            const reply = parseReplyPrefix(message.body);
            const messageQuery = elements.messageSearchInput.value.trim();
            if (reply) {
                row.classList.add("has-reply");
                const quote = document.createElement("div");
                quote.className = "reply-quote";
                quote.setAttribute("role", "note");
                quote.setAttribute("aria-label", `Reply to ${reply.title}: ${reply.quote}`);
                quote.title = reply.quote;
                const quoteTitle = document.createElement("strong");
                quoteTitle.textContent = reply.title;
                const quoteText = document.createElement("span");
                quoteText.dir = "auto";
                appendHighlightedText(quoteText, reply.quote, messageQuery);
                quote.append(quoteTitle, quoteText);
                bubble.appendChild(quote);
            }
            const body = document.createElement("div");
            body.className = "message-body";
            body.dir = "auto";
            appendMessageBody(body, reply ? reply.body : message.body, messageQuery);
            bubble.appendChild(body);
        }
    }

    const footer = document.createElement("div");
    footer.className = "message-footer";
    const time = document.createElement("time");
    time.dateTime = message.created_at || "";
    time.textContent = formatTime(message.created_at);
    footer.appendChild(time);
    const status = messageStatusLabel(message);
    if (status) {
        const statusNode = document.createElement("span");
        statusNode.className = "message-status";
        statusNode.dataset.status = message.status || "sent";
        statusNode.textContent = status;
        statusNode.setAttribute("aria-label", `Message ${status.toLowerCase()}`);
        statusNode.title = `Message ${status.toLowerCase()}`;
        footer.appendChild(statusNode);
    }

    if (!message.is_deleted) {
        const tools = document.createElement("span");
        tools.className = "message-tools";
        const replyButton = document.createElement("button");
        replyButton.type = "button";
        replyButton.className = "message-action-btn";
        replyButton.textContent = "Reply";
        replyButton.setAttribute("aria-label", "Reply to this message");
        replyButton.addEventListener("click", () => startReply(message));
        tools.appendChild(replyButton);
        if (mine && !message.client_id) {
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "message-action-btn danger";
            deleteButton.textContent = "Delete";
            deleteButton.setAttribute("aria-label", "Delete this message");
            deleteButton.addEventListener("click", () => window.ChatMessaging?.openDeleteModal(message));
            tools.appendChild(deleteButton);
        }
        footer.appendChild(tools);
    }

    bubble.appendChild(footer);
    row.appendChild(bubble);

    row.appendChild(buildMessageQuickActions(message));

    window.ChatMessaging?.enhanceMessageRow(row, message, context);
    return row;
}

function buildMessageQuickActions(message) {
    const quickActions = document.createElement("div");
    quickActions.className = "message-row-actions";
    quickActions.setAttribute("role", "toolbar");
    quickActions.setAttribute("aria-label", "Message quick actions");

    const quickReply = createMessageQuickButton("↩", "Reply to this message", () => startReply(message));
    const quickReact = createMessageQuickButton("+", "React to this message", (event) => {
        window.ChatMessaging?.showReactionPicker(event, message);
    });
    quickReact.dataset.openReactions = "true";
    const quickCopy = createMessageQuickButton("Copy", "Copy message text", () => copyMessage(message), "is-label");
    const quickMore = createMessageQuickButton("⋯", "More message actions", (event) => openMessageContextMenu(event, message));

    quickActions.append(quickReply, quickReact, quickCopy, quickMore);
    return quickActions;
}

function createMessageQuickButton(label, ariaLabel, handler, extraClass = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `message-quick-btn ${extraClass}`.trim();
    button.textContent = label;
    button.title = ariaLabel;
    button.setAttribute("aria-label", ariaLabel);
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        handler(event);
    });
    return button;
}

function saveActiveScrollPosition() {
    if (!state.activeConversation || !elements.messageList) return;
    state.scrollPositions[state.activeConversation.id] = elements.messageList.scrollTop;
    state.messageWindowStarts[state.activeConversation.id] = state.messageWindowStart;
}

function isNearBottom(threshold = 120) {
    if (!elements.messageList) return true;
    const distance = elements.messageList.scrollHeight - elements.messageList.scrollTop - elements.messageList.clientHeight;
    return distance <= threshold;
}

function updateJumpLatest() {
    if (!elements.jumpLatestBtn || !state.activeConversation) return;
    const show = !isNearBottom(180) && state.messages.length > 0;
    if (!show) state.unreadBelowCount = 0;
    const count = state.unreadBelowCount;
    elements.jumpLatestBtn.textContent = count > 0
        ? `${count} new message${count === 1 ? "" : "s"}`
        : "Jump to latest";
    elements.jumpLatestBtn.dataset.count = count ? String(count) : "";
    elements.jumpLatestBtn.setAttribute("aria-label", count > 0
        ? `Jump to latest, ${count} new message${count === 1 ? "" : "s"}`
        : "Jump to latest messages");
    elements.jumpLatestBtn.classList.toggle("hidden", !show);
}

function ensureFloatingDateIndicator() {
    if (state.floatingDateIndicator) return state.floatingDateIndicator;
    const indicator = document.createElement("div");
    indicator.className = "floating-date-indicator hidden";
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-live", "polite");
    elements.chatView?.appendChild(indicator);
    state.floatingDateIndicator = indicator;
    return indicator;
}

function updateFloatingDateIndicator() {
    state.scrollDateFrame = null;
    const indicator = ensureFloatingDateIndicator();
    if (!indicator || !state.activeConversation || !state.messages.length) return;
    const listRect = elements.messageList.getBoundingClientRect();
    const anchorY = listRect.top + 54;
    const rows = Array.from(elements.messageList.querySelectorAll(".message-row[data-created-at]"));
    let activeDate = "";
    for (const row of rows) {
        if (row.getBoundingClientRect().top <= anchorY) {
            activeDate = row.dataset.createdAt;
        } else {
            break;
        }
    }
    if (!activeDate) activeDate = rows[0]?.dataset.createdAt || "";
    indicator.textContent = activeDate ? formatMessageSeparator(activeDate) : "";
    indicator.classList.toggle("hidden", !indicator.textContent);
    indicator.classList.add("is-visible");
    window.clearTimeout(state.scrollDateTimer);
    state.scrollDateTimer = window.setTimeout(() => indicator.classList.remove("is-visible"), 900);
}

function scheduleFloatingDateIndicator() {
    if (state.scrollDateFrame) return;
    state.scrollDateFrame = requestAnimationFrame(updateFloatingDateIndicator);
}

function scrollToBottom(options = {}) {
    const behavior = options.smooth === false || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    state.unreadBelowCount = 0;
    elements.messageList.scrollTo({ top: elements.messageList.scrollHeight, behavior });
    if (state.activeConversation) {
        state.scrollPositions[state.activeConversation.id] = elements.messageList.scrollHeight;
    }
    updateJumpLatest();
}

function settleMessageScroll(query = "") {
    if (query) {
        elements.messageList.scrollTop = 0;
        updateJumpLatest();
        return;
    }

    const unreadSeparator = elements.messageList.querySelector(".unread-separator");
    if (unreadSeparator) {
        unreadSeparator.scrollIntoView({ block: "center", behavior: "auto" });
        updateJumpLatest();
        return;
    }

    const saved = state.scrollPositions[state.activeConversation?.id];
    if (typeof saved === "number") {
        elements.messageList.scrollTop = Math.min(saved, elements.messageList.scrollHeight);
        updateJumpLatest();
        return;
    }

    scrollToBottom({ smooth: false });
}

function createOptimisticMessage(body) {
    const now = new Date().toISOString();
    const clientId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
        id: clientId,
        client_id: clientId,
        client_status: "sending",
        conversation_id: state.activeConversation.id,
        sender: {
            id: currentUserId,
            username: state.currentUser?.username || "me",
            display_name: state.currentUser?.display_name || "You",
            profile_photo: state.currentUser?.profile_photo || null,
            is_online: true
        },
        body,
        message_type: "text",
        status: "sent",
        delivered_at: null,
        read_at: null,
        is_deleted: false,
        deleted_for_everyone: false,
        edited_at: null,
        is_forwarded: false,
        forward_from_name: null,
        created_at: now,
        attachment: null,
        reactions: []
    };
}

function reconcileOptimisticMessage(realMessage) {
    if (!realMessage) return false;
    const existingRealIndex = state.messages.findIndex((item) => item.id === realMessage.id);
    if (existingRealIndex >= 0) {
        const before = state.messages.length;
        state.messages = state.messages.filter((item) =>
            !item.client_id || item.id === realMessage.id || item.body !== realMessage.body
        );
        if (state.messages.length !== before) renderMessages();
        return true;
    }
    const tempIndex = state.messages.findIndex((item) =>
        item.client_id
        && item.conversation_id === realMessage.conversation_id
        && item.sender?.id === realMessage.sender?.id
        && item.body === realMessage.body
    );
    if (tempIndex === -1) return false;
    state.messages[tempIndex] = realMessage;
    renderMessages({ animateMessageId: realMessage.id });
    return true;
}

function markOptimisticFailed(clientId, message = "Message could not be sent.") {
    const target = state.messages.find((item) => item.client_id === clientId);
    if (!target) return;
    target.client_status = "failed";
    renderMessages();
    toast(message, "error");
}

function addIncomingMessage(message) {
    if (state.messages.some((item) => item.id === message.id)) return;
    if (state.activeConversation?.id === message.conversation_id) {
        if (reconcileOptimisticMessage(message)) {
            updateJumpLatest();
            return;
        }
        const stickToBottom = isNearBottom();
        const empty = elements.messageList.querySelector(".message-empty-state");
        if (empty) empty.remove();
        state.messages.push(message);
        appendMessageToList(message, { animateMessageId: message.id });
        window.ChatMessaging?.updateSearchNav();
        if (stickToBottom) {
            scrollToBottom();
        } else {
            if (message.sender.id !== currentUserId) state.unreadBelowCount += 1;
            updateJumpLatest();
            if (message.sender.id !== currentUserId) toast("New message below.");
        }
        if (message.sender.id !== currentUserId) markConversationRead();
    }
}

function updateConversationAfterMessage(message) {
    const conversation = state.conversations.find((item) => item.id === message.conversation_id);
    if (!conversation) {
        refreshConversations();
        return;
    }
    conversation.last_message = message;
    conversation.last_message_at = message.created_at;
    if (state.activeConversation?.id !== message.conversation_id && message.sender.id !== currentUserId) {
        conversation.unread_count = (conversation.unread_count || 0) + 1;
    }
    state.conversations.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
    renderConversations();
}

async function markConversationRead() {
    if (!state.activeConversation) return;
    state.activeConversation.unread_count = 0;
    if (socket) {
        socket.emit("conversation_read", { conversation_id: state.activeConversation.id });
    } else {
        await api(`/api/conversations/${state.activeConversation.id}/read`, { method: "POST" });
    }
}

function startReply(message) {
    if (!message || message.is_deleted) return;
    state.replyTo = message;
    elements.replyPreviewTitle.textContent = `Reply to ${message.sender.display_name}`;
    elements.replyPreviewText.textContent = replyBody(message);
    elements.replyPreview.classList.remove("hidden");
    elements.replyPreview.classList.add("is-entering");
    window.setTimeout(() => elements.replyPreview.classList.remove("is-entering"), 220);
    elements.messageInput.focus();
    closeMessageContextMenu();
}

function cancelReply() {
    state.replyTo = null;
    elements.replyPreview.classList.add("hidden");
    elements.replyPreviewTitle.textContent = "";
    elements.replyPreviewText.textContent = "";
}

async function copyMessage(message) {
    const text = parseReplyPrefix(message.body)?.body || message.body || message.attachment?.url || "";
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        toast("Message copied.");
    } catch {
        toast("Copy is unavailable in this browser.", "error");
    }
    closeMessageContextMenu();
}

function openMessageContextMenu(event, message) {
    if (!elements.messageContextMenu || message.is_deleted) return;
    event.preventDefault();
    state.contextMessage = message;
    window.ChatMessaging?.updateContextMenuVisibility(message);
    const row = event.currentTarget?.closest?.(".message-row")
        || event.target?.closest?.(".message-row")
        || elements.messageList.querySelector(`[data-message-id="${message.id}"]`);
    if (!state.selectMode) {
        document.querySelectorAll(".message-row.is-selected").forEach((selectedRow) => selectedRow.classList.remove("is-selected"));
        row?.classList.add("is-selected");
    }
    elements.messageContextMenu.classList.remove("hidden", "is-exiting");
    elements.messageContextMenu.classList.add("is-entering");
    window.setTimeout(() => elements.messageContextMenu.classList.remove("is-entering"), 200);
    const visibleActions = elements.messageContextMenu.querySelectorAll("button:not(.hidden)").length;
    const menuRect = elements.messageContextMenu.getBoundingClientRect();
    const menuWidth = Math.max(168, Math.ceil(menuRect.width || 0));
    const menuHeight = Math.max(92, Math.ceil(menuRect.height || visibleActions * 44));
    const anchor = row?.querySelector(".message-bubble")?.getBoundingClientRect()
        || { left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY };
    const displayMine = displayAsMine(message.sender.id);
    const preferredX = displayMine ? anchor.left - menuWidth - 8 : anchor.right + 8;
    const x = Math.min(Math.max(12, preferredX), window.innerWidth - menuWidth - 12);
    const y = Math.min(Math.max(12, anchor.top + Math.min(8, anchor.height / 3)), window.innerHeight - menuHeight - 12);
    elements.messageContextMenu.style.left = `${Math.max(12, x)}px`;
    elements.messageContextMenu.style.top = `${Math.max(12, y)}px`;
    const firstAction = elements.messageContextMenu.querySelector("button:not(.hidden)");
    firstAction?.focus({ preventScroll: true });
}

function closeMessageContextMenu() {
    if (!elements.messageContextMenu || elements.messageContextMenu.classList.contains("hidden")) return;
    document.querySelectorAll(".message-row.is-selected").forEach((row) => row.classList.remove("is-selected"));
    elements.messageContextMenu.classList.add("is-exiting");
    window.setTimeout(() => {
        elements.messageContextMenu.classList.add("hidden");
        elements.messageContextMenu.classList.remove("is-exiting");
    }, 160);
    state.contextMessage = null;
}

async function deleteMessage(message) {
    window.ChatMessaging?.openDeleteModal(typeof message === "object" ? message : state.messages.find((item) => item.id === message));
}

async function openGroupDrawer() {
    const conversation = state.activeConversation;
    if (!conversation || conversation.type !== "group") return;
    try {
        const payload = await api(`/api/groups/${conversation.group.id}`);
        renderGroupDrawer(payload);
        elements.drawerScrim.classList.add("open", "is-visible");
        elements.groupDrawer.classList.add("open", "is-open", "is-entering");
        elements.groupDrawer.setAttribute("aria-hidden", "false");
        elements.groupInfoBtn?.setAttribute("aria-expanded", "true");
        window.setTimeout(() => elements.groupDrawer.classList.remove("is-entering"), 280);
        elements.drawerCloseBtn.focus({ preventScroll: true });
    } catch (error) {
        toast(error.message, "error");
    }
}

function closeGroupDrawer() {
    const wasOpen = elements.groupDrawer.classList.contains("open");
    if (!wasOpen) return;
    elements.groupDrawer.classList.add("is-exiting");
    elements.drawerScrim.classList.remove("is-visible");
    window.setTimeout(() => {
        elements.groupDrawer.classList.remove("open", "is-open", "is-exiting");
        elements.drawerScrim.classList.remove("open");
        elements.groupDrawer.setAttribute("aria-hidden", "true");
        elements.groupInfoBtn?.setAttribute("aria-expanded", "false");
        if (wasOpen) elements.groupInfoBtn.focus({ preventScroll: true });
    }, 220);
}

function renderGroupDrawer(payload) {
    elements.drawerTitle.textContent = payload.group.name;
    elements.drawerDescription.textContent = payload.group.description || "";
    elements.drawerMembers.replaceChildren();

    for (const member of payload.members) {
        const actions = [];
        if (payload.current_role === "admin" && member.user.id !== currentUserId) {
            actions.push(["Remove", "small-btn danger", () => removeGroupMember(payload.group.id, member.user.id)]);
        }
        elements.drawerMembers.appendChild(buildUserRow(member.user, {
            subtitle: member.role,
            actions
        }));
    }

    const memberIds = new Set(payload.members.map((member) => member.user.id));
    const eligibleFriends = state.friends.filter((friend) => !memberIds.has(friend.id));
    elements.drawerFriendChoices.replaceChildren();
    elements.addMembersForm.classList.toggle("hidden", payload.current_role !== "admin");
    if (payload.current_role === "admin") {
        if (!eligibleFriends.length) {
            elements.drawerFriendChoices.appendChild(buildListEmpty("No friends available."));
        }
        for (const friend of eligibleFriends) {
            const label = document.createElement("label");
            label.className = "check-row";
            const span = document.createElement("span");
            span.textContent = friend.display_name;
            const input = document.createElement("input");
            input.type = "checkbox";
            input.value = friend.id;
            label.append(span, input);
            elements.drawerFriendChoices.appendChild(label);
        }
    }
}

async function removeGroupMember(groupId, userId) {
    try {
        await api(`/api/groups/${groupId}/members/${userId}`, { method: "DELETE" });
        await openGroupDrawer();
        await refreshConversations();
    } catch (error) {
        toast(error.message, "error");
    }
}

async function addSelectedGroupMembers(event) {
    event.preventDefault();
    const ids = $$("#drawerFriendChoices input:checked").map((input) => Number(input.value));
    if (!ids.length || !state.activeConversation) return;
    try {
        await api(`/api/groups/${state.activeConversation.group.id}/members`, {
            method: "POST",
            body: { user_ids: ids }
        });
        await openGroupDrawer();
        await refreshConversations();
    } catch (error) {
        toast(error.message, "error");
    }
}

function setupConnection() {
    if (!window.ConnectionManager) return;

    window.ConnectionManager.start();

    document.addEventListener("connection:restored", async () => {
        toast("Connection restored.");
        await refreshConversations();
        if (state.activeConversation) {
            await loadMessages();
            markConversationRead();
        }
        await refreshFriendsAndRequests();
        await window.ConnectionManager.flushActionQueue();
    });

    document.addEventListener("connection:lost", () => {
        if (!state.connectionLost) {
            toast("Connection lost. Reconnecting...", "warning");
        }
    });
}

function setupSocket() {
    if (!socket) {
        window.ConnectionManager?.setSocketStatus("unavailable");
        toast("Socket.IO client could not load. Text messages will fall back to REST.", "warning");
        return;
    }

    socket.on("connect", async () => {
        state.socketReady = true;
        window.ConnectionManager?.setSocketStatus("connected");
        if (state.connectionLost) state.connectionLost = false;
    });

    socket.on("disconnect", (reason) => {
        state.socketReady = false;
        if (reason === "io client disconnect") {
            window.ConnectionManager?.setSocketStatus("disconnected");
            return;
        }
        state.connectionLost = true;
        window.ConnectionManager?.setSocketStatus("reconnecting");
    });

    socket.on("connect_error", () => {
        state.socketReady = false;
        state.connectionLost = true;
        window.ConnectionManager?.setSocketStatus("reconnecting");
    });

    socket.io.on("reconnect", () => {
        window.ConnectionManager?.setSocketStatus("connected");
    });

    socket.io.on("reconnect_attempt", () => {
        window.ConnectionManager?.setSocketStatus("reconnecting");
    });

    socket.io.on("reconnect_failed", () => {
        window.ConnectionManager?.setSocketStatus("disconnected");
        toast("Realtime connection could not be restored. Messages will use REST.", "warning");
    });

    if (socket.connected) {
        state.socketReady = true;
        window.ConnectionManager?.setSocketStatus("connected");
    }

    socket.on("socket:ready", () => {
        state.socketReady = true;
    });

    socket.on("message:new", (message) => {
        addIncomingMessage(message);
        updateConversationAfterMessage(message);
    });

    socket.on("message:status", (payload) => {
        const message = state.messages.find((item) => item.id === payload.message_id);
        if (message) {
            message.status = payload.status;
            message.delivered_at = payload.delivered_at;
            message.read_at = payload.read_at;
            if (!patchMessageStatus(payload.message_id, { status: payload.status })) {
                scheduleRenderMessages();
            }
        }
    });

    socket.on("message:read", (payload) => {
        let changed = false;
        for (const message of state.messages) {
            if (payload.message_ids.includes(message.id)) {
                message.status = "seen";
                message.read_at = payload.read_at;
                changed = true;
            }
        }
        if (changed) patchMessageStatuses(payload.message_ids, "seen", payload.read_at);
    });

    socket.on("message:deleted", (payload) => {
        const message = state.messages.find((item) => item.id === payload.message_id);
        if (message) {
            message.is_deleted = true;
            message.deleted_for_everyone = payload.deleted_for_everyone;
            message.body = "";
            message.attachment = null;
            message.message_type = "deleted";
            renderMessages();
        }
    });

    socket.on("message:edited", (payload) => {
        window.ChatMessaging?.applySocketEdit(payload);
    });

    socket.on("message:reaction", (payload) => {
        window.ChatMessaging?.applySocketReaction(payload);
    });

    socket.on("message:pinned", (payload) => {
        window.ChatMessaging?.applySocketPinned(payload);
    });

    socket.on("message:unpinned", (payload) => {
        window.ChatMessaging?.applySocketUnpinned(payload);
    });

    socket.on("typing:update", (payload) => {
        if (state.activeConversation?.id !== payload.conversation_id) return;
        elements.typingIndicator.dataset.typist = payload.is_typing ? payload.display_name : "";
        elements.typingIndicator.textContent = payload.is_typing ? `${payload.display_name} is typing` : "";
        elements.typingIndicator.classList.toggle("active", Boolean(payload.is_typing));
        clearTimeout(state.typingTimer);
        state.typingTimer = setTimeout(() => {
            elements.typingIndicator.textContent = "";
            elements.typingIndicator.dataset.typist = "";
            elements.typingIndicator.classList.remove("active");
        }, 1600);
    });

    socket.on("notification:new", (payload) => {
        if (payload.type === "friend_request" || payload.type === "friend_accept") {
            refreshFriendsAndRequests();
        }
        if (payload.type === "group") {
            refreshConversations();
        }
        if (payload.type !== "message" || state.activeConversation?.id !== payload.conversation_id) {
            toast(payload.message || "New notification");
        }
    });

    socket.on("user:status", (payload) => {
        for (const friend of state.friends) {
            if (friend.id === payload.user_id) {
                friend.is_online = payload.is_online;
                friend.last_seen = payload.last_seen;
            }
        }
        for (const conversation of state.conversations) {
            if (conversation.other_user?.id === payload.user_id) {
                conversation.other_user.is_online = payload.is_online;
                conversation.other_user.last_seen = payload.last_seen;
                if (state.activeConversation?.id === conversation.id) updateChatStatus(conversation);
            }
        }
        renderFriends();
        renderConversations();
    });

    socket.on("group:removed", () => {
        toast("You were removed from a group.");
        refreshConversations();
    });
}

function setupSearchFeedback(input) {
    if (!input) return;
    const box = input.closest(".search-box");
    const sync = () => {
        box?.classList.toggle("has-value", Boolean(input.value.trim()));
    };
    input.addEventListener("input", sync);
    input.addEventListener("search", sync);
    sync();
}

function setupEvents() {
    $$(".tab-btn").forEach((button) => {
        button.addEventListener("click", () => setPanel(button.dataset.panel));
    });

    elements.conversationFilter.addEventListener("input", renderConversations);
    [
        elements.conversationFilter,
        elements.userSearchInput,
        elements.messageSearchInput
    ].forEach(setupSearchFeedback);

    elements.userSearchInput.addEventListener("input", () => {
        clearTimeout(state.userSearchTimer);
        state.userSearchTimer = setTimeout(async () => {
            const query = elements.userSearchInput.value.trim();
            if (query.length < 2) {
                elements.userSearchResults.replaceChildren(buildListEmpty("Type at least 2 characters."));
                return;
            }
            try {
                const payload = await api(`/api/users/search?q=${encodeURIComponent(query)}`);
                renderUserSearch(payload.users);
            } catch (error) {
                toast(error.message, "error");
            }
        }, 250);
    });

    elements.createGroupForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const memberIds = $$("#groupFriendChoices input:checked").map((input) => Number(input.value));
        try {
            const payload = await api("/api/groups", {
                method: "POST",
                body: {
                    name: elements.groupName.value.trim(),
                    description: elements.groupDescription.value.trim(),
                    member_ids: memberIds
                }
            });
            upsertConversation(payload.conversation);
            renderConversations();
            elements.createGroupForm.reset();
            openConversation(payload.conversation.id);
            setPanel("conversationsPanel");
        } catch (error) {
            toast(error.message, "error");
        }
    });

    elements.messageForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!state.activeConversation) return;
        const body = elements.messageInput.value.trim();
        const [file] = elements.attachmentInput.files;
        if (!body && !file && !state.replyTo) return;

        if (window.ConnectionManager && !window.ConnectionManager.canSendMessages()) {
            toast("Offline — your draft is saved. Send again when connection returns.", "warning");
            return;
        }

        const finalBody = state.replyTo
            ? `[Reply to ${state.replyTo.sender.display_name}: ${replyBody(state.replyTo)}]\n\n${body}`
            : body;

        if (!file && socket?.connected) {
            const optimistic = createOptimisticMessage(finalBody);
            state.messages.push(optimistic);
            appendMessageToList(optimistic, { animateMessageId: optimistic.id });
            updateConversationAfterMessage(optimistic);
            scrollToBottom();
            elements.messageInput.value = "";
            cancelReply();
            socket.emit(
                "send_message",
                { conversation_id: state.activeConversation.id, body: finalBody },
                (response) => {
                    if (response?.error) {
                        markOptimisticFailed(optimistic.client_id, response.error);
                        return;
                    }
                    if (response?.message) {
                        if (!reconcileOptimisticMessage(response.message)) {
                            addIncomingMessage(response.message);
                        }
                        updateConversationAfterMessage(response.message);
                    }
                }
            );
            return;
        }

        const formData = new FormData();
        formData.append("body", finalBody);
        if (file) formData.append("attachment", file);
        try {
            elements.messageForm.classList.add("is-sending", "is-loading");
            const payload = await api(`/api/conversations/${state.activeConversation.id}/messages`, {
                method: "POST",
                body: formData
            });
            if (!socket?.connected) {
                addIncomingMessage(payload.message);
                updateConversationAfterMessage(payload.message);
            }
            elements.messageInput.value = "";
            elements.attachmentInput.value = "";
            elements.attachmentChip.classList.add("hidden");
            cancelReply();
        } catch (error) {
            toast(error.message, "error");
        } finally {
            elements.messageForm.classList.remove("is-sending", "is-loading");
        }
    });

    elements.messageInput.addEventListener("input", () => {
        if (!socket || !state.activeConversation) return;
        socket.emit("typing", { conversation_id: state.activeConversation.id, is_typing: true });
        clearTimeout(state.typingTimer);
        state.typingTimer = setTimeout(() => {
            socket.emit("typing", { conversation_id: state.activeConversation.id, is_typing: false });
        }, 900);
    });

    elements.messageList.addEventListener("scroll", () => {
        saveActiveScrollPosition();
        updateJumpLatest();
        scheduleFloatingDateIndicator();
    });

    elements.jumpLatestBtn?.addEventListener("click", () => {
        scrollToBottom();
        elements.messageInput.focus();
    });

    elements.attachmentBtn.addEventListener("click", () => elements.attachmentInput.click());
    elements.attachmentInput.addEventListener("change", () => {
        const [file] = elements.attachmentInput.files;
        if (!file) {
            elements.attachmentChip.classList.add("hidden");
            return;
        }
        elements.attachmentChip.textContent = `Attached: ${file.name} ${formatFileSize(file.size) ? `(${formatFileSize(file.size)})` : ""}`;
        elements.attachmentChip.classList.remove("hidden");
    });

    elements.messageSearchToggle.addEventListener("click", () => {
        elements.messageSearchBar.classList.toggle("hidden");
        const open = !elements.messageSearchBar.classList.contains("hidden");
        elements.messageSearchToggle.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) elements.messageSearchInput.focus();
    });

    elements.messageSearchInput.addEventListener("input", () => {
        state.searchMatchIndex = 0;
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(() => loadMessages(elements.messageSearchInput.value.trim()), 250);
    });

    elements.conversationSearchClear.addEventListener("click", () => {
        elements.conversationFilter.value = "";
        renderConversations();
        elements.conversationFilter.focus();
    });

    elements.userSearchClear.addEventListener("click", () => {
        elements.userSearchInput.value = "";
        renderUserSearch([]);
        elements.userSearchInput.focus();
    });

    elements.messageSearchClear.addEventListener("click", () => {
        elements.messageSearchInput.value = "";
        loadMessages();
        elements.messageSearchInput.focus();
    });

    elements.mobileBackBtn.addEventListener("click", () => document.body.classList.remove("chat-open"));
    elements.groupInfoBtn.addEventListener("click", openGroupDrawer);
    elements.drawerCloseBtn.addEventListener("click", closeGroupDrawer);
    elements.drawerScrim.addEventListener("click", closeGroupDrawer);
    elements.addMembersForm.addEventListener("submit", addSelectedGroupMembers);
    elements.replyCancelBtn.addEventListener("click", cancelReply);

    elements.messageContextMenu.addEventListener("click", (event) => {
        const action = event.target.closest("button")?.dataset.action;
        if (!action || !state.contextMessage) return;
        if (action === "reply") startReply(state.contextMessage);
        else if (action === "copy") copyMessage(state.contextMessage);
        else if (["react", "edit", "forward", "pin", "delete"].includes(action)) {
            window.ChatMessaging?.handleContextAction(action);
        }
    });

    document.addEventListener("click", (event) => {
        if (!elements.messageContextMenu.contains(event.target)) closeMessageContextMenu();
    });

    window.addEventListener("resize", () => {
        closeMessageContextMenu();
        window.ChatMessaging?.hideReactionPicker?.();
    });

    document.addEventListener("keydown", (event) => {
        const key = event.key.toLowerCase();
        const command = event.ctrlKey || event.metaKey;
        if (command && key === "f") {
            event.preventDefault();
            if (event.shiftKey) {
                elements.conversationFilter.focus();
                return;
            }
            if (state.activeConversation) {
                elements.messageSearchBar.classList.remove("hidden");
                elements.messageSearchToggle.setAttribute("aria-expanded", "true");
                elements.messageSearchInput.focus();
                elements.messageSearchInput.select();
            }
            return;
        }
        if (command && event.key === "Enter" && document.activeElement === elements.messageInput) {
            event.preventDefault();
            elements.messageForm.requestSubmit();
            return;
        }
        if ((event.key === "End" && command) || (event.altKey && event.key === "ArrowDown")) {
            if (!state.activeConversation) return;
            event.preventDefault();
            scrollToBottom();
            elements.messageInput.focus();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            if (state.activeConversation && !elements.messageSearchBar.classList.contains("hidden")) {
                elements.messageSearchInput.focus();
                return;
            }
            if (state.activeConversation) {
                elements.messageSearchBar.classList.remove("hidden");
                elements.messageSearchInput.focus();
                return;
            }
            elements.conversationFilter.focus();
            return;
        }
        if (event.key !== "Escape") return;
        closeMessageContextMenu();
        closeGroupDrawer();
        if (!elements.messageSearchBar.classList.contains("hidden")) {
            elements.messageSearchBar.classList.add("hidden");
            elements.messageSearchToggle.setAttribute("aria-expanded", "false");
            elements.messageSearchInput.value = "";
        }
    });

    elements.darkModeToggle.addEventListener("click", () => setDarkMode(!document.body.classList.contains("dark")));
    elements.darkModeCheckbox.addEventListener("change", () => setDarkMode(elements.darkModeCheckbox.checked));
    setupMessageSideToggles();
}

function setupEmojiTray() {
    const emojis = ["😀", "😂", "😊", "😍", "😎", "🤝", "👍", "🙏", "🎉", "🔥", "✅", "💬", "❤️", "✨", "📌", "☕"];
    for (const emoji of emojis) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = emoji;
        button.setAttribute("aria-label", `Insert ${emoji}`);
        button.addEventListener("click", () => {
            elements.messageInput.value += emoji;
            elements.messageInput.focus();
            elements.emojiTray.classList.add("hidden");
            elements.emojiBtn.setAttribute("aria-expanded", "false");
        });
        elements.emojiTray.appendChild(button);
    }
    elements.emojiBtn.addEventListener("click", () => {
        elements.emojiTray.classList.toggle("hidden");
        elements.emojiBtn.setAttribute("aria-expanded", elements.emojiTray.classList.contains("hidden") ? "false" : "true");
    });
}

document.addEventListener("DOMContentLoaded", () => {
    setDarkMode(readDarkMode());
    setupEmojiTray();
    setupInteractiveFeedback();
    setupConnection();
    setupEvents();
    setupSocket();
    window.ChatMessaging?.init({
        state,
        elements,
        api,
        toast: (message, kind) => toast(message, kind, elements.toastStack),
        renderMessages,
        startReply,
        closeMessageContextMenu,
        currentUserId
    });
    loadBootstrap();
});

window.addEventListener("beforeunload", () => {
    if (renderMessagesFrame) cancelAnimationFrame(renderMessagesFrame);
    if (state.scrollDateFrame) cancelAnimationFrame(state.scrollDateFrame);
    clearTimeout(state.typingTimer);
    clearTimeout(state.userSearchTimer);
    clearTimeout(state.searchTimer);
    clearTimeout(state.scrollDateTimer);
    window.ChatMessaging?.destroy?.();
    window.ConnectionManager?.stop();
    if (socket && typeof socket.removeAllListeners === "function") {
        socket.removeAllListeners();
    }
});
