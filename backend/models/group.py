from extensions import db
from time_utils import utc_now


class Group(db.Model):
    __tablename__ = "groups"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.String(300), default="")
    photo = db.Column(db.String(255))
    created_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=utc_now, nullable=False)
    updated_at = db.Column(
        db.DateTime, default=utc_now, onupdate=utc_now, nullable=False
    )

    creator = db.relationship("User", foreign_keys=[created_by_id])
    members = db.relationship("GroupMember", back_populates="group", cascade="all, delete-orphan")

    def to_dict(self):
        active_members = [member for member in self.members if member.is_active]
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description or "",
            "photo": self.photo,
            "created_by_id": self.created_by_id,
            "member_count": len(active_members),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class GroupMember(db.Model):
    __tablename__ = "group_members"

    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    role = db.Column(db.String(20), default="member", nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    joined_at = db.Column(db.DateTime, default=utc_now, nullable=False)
    last_read_at = db.Column(db.DateTime, default=utc_now, nullable=False)

    group = db.relationship("Group", back_populates="members")
    user = db.relationship("User")

    __table_args__ = (
        db.UniqueConstraint("group_id", "user_id", name="uq_group_member"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "role": self.role,
            "is_active": self.is_active,
            "joined_at": self.joined_at.isoformat() if self.joined_at else None,
            "last_read_at": self.last_read_at.isoformat() if self.last_read_at else None,
            "user": self.user.to_public_dict(),
        }
