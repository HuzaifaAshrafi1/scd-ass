from flask import Blueprint, flash, g, redirect, render_template, request, url_for

from extensions import db
from controllers.helpers import login_required, sanitize_text, save_upload
from time_utils import utc_now


profile_bp = Blueprint("profile", __name__)


@profile_bp.route("/profile", methods=["GET", "POST"])
@login_required
def profile():
    if request.method == "POST":
        g.user.display_name = sanitize_text(request.form.get("display_name"), 80) or g.user.username
        g.user.bio = sanitize_text(request.form.get("bio"), 280)

        photo = request.files.get("profile_photo")
        if photo and photo.filename:
            upload = save_upload(photo, "AVATAR_UPLOAD_FOLDER", image_only=True)
            g.user.profile_photo = upload["url_path"]

        g.user.updated_at = utc_now()
        db.session.commit()
        flash("Profile updated.", "success")
        return redirect(url_for("profile.profile"))

    return render_template("profile.html")
