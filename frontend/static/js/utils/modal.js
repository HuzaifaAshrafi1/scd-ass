(() => {
    function showModal(modal, scrim) {
        modal?.classList.remove("hidden");
        scrim?.classList.remove("hidden");
    }

    function hideModal(modal, scrim) {
        modal?.classList.add("hidden");
        scrim?.classList.add("hidden");
    }

    window.AppUtils = window.AppUtils || {};
    Object.assign(window.AppUtils, { showModal, hideModal });
})();
