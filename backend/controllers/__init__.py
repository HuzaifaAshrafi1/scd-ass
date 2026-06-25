from .auth_controller import auth_bp
from .friends_controller import friends_bp
from .chat_controller import chat_bp
from .profile_controller import profile_bp


__all__ = ["auth_bp", "chat_bp", "friends_bp", "profile_bp"]
