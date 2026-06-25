from datetime import timedelta

from sqlalchemy import or_

from app import create_app
from extensions import db
from models import Conversation, Friend, FriendRequest, Group, GroupMember, Message, User
from time_utils import utc_now


SAMPLE_PASSWORD = "Password123!"
DEMO_USERNAME = "user"
DEMO_PASSWORD = "12345678"

# 42 additional contacts — demo user also friends with ahmed, ayesha, usman, fatima (46 total).
DUMMY_CONTACTS = [
    ("hassan_raza", "Hassan Raza", "Loves cricket and late-night coding sessions."),
    ("mariam_khan", "Mariam Khan", "UI/UX enthusiast and Figma power user."),
    ("bilal_ahmed", "Bilal Ahmed", "Database design and ER diagrams."),
    ("zainab_malik", "Zainab Malik", "Mobile-first layouts and responsive CSS."),
    ("omar_siddiqui", "Omar Siddiqui", "DevOps curious, Docker beginner."),
    ("sana_qureshi", "Sana Qureshi", "Writes clean API documentation."),
    ("hamza_ali", "Hamza Ali", "Socket.IO and real-time features fan."),
    ("hira_shah", "Hira Shah", "QA tester who finds edge cases."),
    ("tariq_hussain", "Tariq Hussain", "Project manager for side hustles."),
    ("nadia_begum", "Nadia Begum", "React components and state management."),
    ("imran_yousaf", "Imran Yousaf", "Flask blueprints and REST APIs."),
    ("rabia_akhtar", "Rabia Akhtar", "Accessibility and semantic HTML."),
    ("saad_mehmood", "Saad Mehmood", "Git workflows and pull requests."),
    ("amna_rizvi", "Amna Rizvi", "SQLite tuning and query plans."),
    ("fahad_nawaz", "Fahad Nawaz", "Deployment on Windows and Linux."),
    ("sadia_imran", "Sadia Imran", "Peer review and code style."),
    ("kashif_abbas", "Kashif Abbas", "Authentication and JWT tokens."),
    ("laiba_hassan", "Laiba Hassan", "Dark mode and theme switching."),
    ("arsalan_khan", "Arsalan Khan", "WebSockets debugging expert."),
    ("mehwish_ansari", "Mehwish Ansari", "User stories and sprint planning."),
    ("danish_riaz", "Danish Riaz", "File uploads and media handling."),
    ("sumaira_javed", "Sumaira Javed", "Chat bubbles and message status."),
    ("waleed_aslam", "Waleed Aslam", "Group chat admin controls."),
    ("hina_parvez", "Hina Parvez", "Friend requests and contact lists."),
    ("junaid_iqbal", "Junaid Iqbal", "Search and filter in chat UI."),
    ("farah_naz", "Farah Naz", "Emoji reactions and message pins."),
    ("adnan_sheikh", "Adnan Sheikh", "Profile photos and avatars."),
    ("nida_farooq", "Nida Farooq", "Online status and last seen."),
    ("shahzad_mirza", "Shahzad Mirza", "Message forwarding and replies."),
    ("ayesha_rehman", "Ayesha Rehman", "Notification sounds and badges."),
    ("usman_gill", "Usman Gill", "Cross-browser testing on Chrome."),
    ("fatima_zahra", "Fatima Zahra", "Assignment deadlines tracker."),
    ("ali_haider", "Ali Haider", "Semester project presentation prep."),
    ("saima_ashraf", "Saima Ashraf", "README and setup instructions."),
    ("kamran_butt", "Kamran Butt", "Virtual env and pip installs."),
    ("rida_mazhar", "Rida Mazhar", "Seed data and demo accounts."),
    ("hassan_javed", "Hassan Javed", "WeChat-style sidebar layout."),
    ("noor_ul_ain", "Noor ul Ain", "Typing indicators and read receipts."),
    ("bilal_hussain", "Bilal Hussain", "Message edit and delete flows."),
    ("saba_akram", "Saba Akram", "Contact search and alphabet index."),
    ("taha_malik", "Taha Malik", "Flask-SocketIO event handlers."),
    ("zoya_ahmed", "Zoya Ahmed", "SQLite WAL mode and backups."),
]

CHAT_SCRIPTS = [
    [
        ("other", "Assalam o Alaikum! Did you see the latest assignment post?"),
        ("self", "Wa Alaikum Assalam, yes just checked it."),
        ("other", "The deadline moved to next Friday."),
        ("self", "Good to know, I'll finish my part tonight."),
        ("other", "Same here. Want to review together tomorrow?"),
        ("self", "Sure, library at 4pm works for me."),
        ("other", "Perfect. I'll bring my laptop."),
        ("self", "See you then in sha Allah."),
        ("other", "In sha Allah. Take care!"),
    ],
    [
        ("other", "Hey, are you free for a quick call?"),
        ("self", "Give me 5 minutes, almost done with lunch."),
        ("other", "No rush, ping me when ready."),
        ("self", "Okay I'm back now."),
        ("other", "Great. I wanted to ask about the group chat feature."),
        ("self", "Yeah it supports admin roles and member invites."),
        ("other", "Nice. Does it show read receipts?"),
        ("self", "Yes, delivered and seen status both work."),
        ("other", "Awesome, thanks for explaining!"),
        ("self", "Anytime. Let me know if you hit any bugs."),
        ("other", "Will do. JazakAllah khair."),
    ],
    [
        ("self", "Did the seed script run okay on your machine?"),
        ("other", "Yep, all sample users loaded fine."),
        ("self", "Cool. Login with user / 12345678 for the demo."),
        ("other", "Works perfectly. Chat list looks full now."),
        ("self", "That's the goal — realistic demo data."),
        ("other", "Messages have nice timestamps too."),
        ("self", "Spread over the last couple of weeks."),
        ("other", "Makes the UI feel alive. Good job."),
        ("self", "Thanks! Submit whenever you're ready."),
    ],
    [
        ("other", "Bhai, cricket match kal sham ko?"),
        ("self", "Haan in sha Allah, ground pe milte hain."),
        ("other", "6 baje theek hai?"),
        ("self", "6:30 better for me, class ends at 6."),
        ("other", "Done. Bring your bat this time 😄"),
        ("self", "Haha okay okay, last time I forgot."),
        ("other", "Team needs one more player too."),
        ("self", "I'll ask Junaid, he's usually free."),
        ("other", "Chalo great. See you there."),
        ("self", "See you. Don't be late!"),
        ("other", "Never early, never on time 😂"),
    ],
    [
        ("other", "Quick question — which port is Flask running on?"),
        ("self", "Default is 5000, check start_app.cmd output."),
        ("other", "Got it. Frontend talks to same origin?"),
        ("self", "Yes, static files served from Flask."),
        ("other", "Socket.IO connects automatically then?"),
        ("self", "Right, no extra config needed locally."),
        ("other", "Sweet. I'll test file uploads next."),
        ("self", "Uploads go to backend/uploads folder."),
        ("other", "Noted. Thanks!"),
    ],
    [
        ("self", "Assalam o Alaikum, how's the presentation prep going?"),
        ("other", "Wa Alaikum Assalam, slides are 80% done."),
        ("self", "Want me to review the demo section?"),
        ("other", "Yes please, especially the chat flow."),
        ("self", "I'll record a short walkthrough tonight."),
        ("other", "That would help a lot."),
        ("self", "Also adding more dummy contacts for realism."),
        ("other", "Smart move for the viva demo."),
        ("self", "Exactly. Judges love a populated UI."),
        ("other", "Haha true. Good luck!"),
        ("self", "You too. We got this."),
    ],
    [
        ("other", "Coffee break?"),
        ("self", "Always. Canteen in 10?"),
        ("other", "Deal. I need a break from debugging."),
        ("self", "Same. Socket event was firing twice."),
        ("other", "Classic duplicate listener issue?"),
        ("self", "Yeah, fixed it with off() before on()."),
        ("other", "Nice catch. Tell me over chai."),
        ("self", "On my way."),
    ],
    [
        ("other", "MashAllah the chat UI looks clean now."),
        ("self", "Thanks, spent time on the sidebar scroll."),
        ("other", "Search bar is handy too."),
        ("self", "Filters contacts and conversations."),
        ("other", "Mobile layout also works well."),
        ("self", "Tested on a few screen sizes."),
        ("other", "Ready for submission then?"),
        ("self", "Almost, just polishing seed data."),
        ("other", "Looks great already."),
        ("self", "Appreciate it!"),
        ("other", "No problem, happy to help test."),
        ("self", "I'll add you to the demo group too."),
    ],
]

EXTRA_GROUPS = [
    {
        "name": "CS Study Circle",
        "description": "Weekly study sessions and exam prep.",
        "messages": [
            ("usman", "Quiz on Thursday — chapter 5 and 6."),
            ("ayesha", "I'll share my notes in the group."),
            ("demo", "Thanks, that helps a lot."),
            ("ahmed", "Can we do a review session Wednesday?"),
            ("usman", "7pm in the lab works for me."),
            ("ayesha", "Same here."),
            ("demo", "I'll be there in sha Allah."),
        ],
    },
    {
        "name": "Friday Cricket Group",
        "description": "Weekend matches and team coordination.",
        "messages": [
            ("hassan_raza", "Ground booked for Friday 6pm."),
            ("bilal_ahmed", "I'm in. Need 2 more players."),
            ("demo", "Count me in."),
            ("omar_siddiqui", "I'll bring the ball."),
            ("hassan_raza", "Team A vs Team B again?"),
            ("bilal_ahmed", "Yes, same teams as last week."),
            ("demo", "Let's go!"),
        ],
    },
    {
        "name": "Hostel Roommates",
        "description": "Daily hostel coordination and errands.",
        "messages": [
            ("hamza_ali", "Who's buying groceries today?"),
            ("demo", "I can go after Maghrib."),
            ("tariq_hussain", "Add milk and bread to the list please."),
            ("hamza_ali", "And eggs if they have fresh ones."),
            ("demo", "Got it, I'll send a photo of the receipt."),
            ("tariq_hussain", "JazakAllah bhai."),
        ],
    },
    {
        "name": "Assignment Help Desk",
        "description": "Quick questions about the semester project.",
        "messages": [
            ("sana_qureshi", "Is the report template on the portal?"),
            ("mariam_khan", "Yes, under Resources > Templates."),
            ("demo", "Page limit is 15 right?"),
            ("sana_qureshi", "Correct, excluding appendix."),
            ("mariam_khan", "Submit PDF only, not Word."),
            ("demo", "Thanks both!"),
            ("sana_qureshi", "Good luck everyone."),
        ],
    },
    {
        "name": "FYP Lab Group",
        "description": "Weekend lab coordination for final-year project milestones.",
        "messages": [
            ("ayesha", "Lab session moved to Sunday 4 pm — computer lab 2."),
            ("fatima", "Works for me."),
            ("usman", "I might be 15 min late, traffic on GT Road."),
            ("demo", "I will bring the printed report draft."),
            ("ayesha", "Please also test the WeChat clone on your phones."),
            ("fatima", "Tested on Android — responsive layout looks good."),
            ("usman", "iPhone Safari works too, just a minor scroll quirk."),
            ("ayesha", "Note it in the known issues slide."),
        ],
    },
]


def ensure_user(username, display_name, bio, password=SAMPLE_PASSWORD, force_password=False):
    user = User.query.filter_by(username=username).first()
    if user:
        if force_password:
            user.set_password(password)
        return user
    user = User(username=username, display_name=display_name, bio=bio)
    user.set_password(password)
    db.session.add(user)
    db.session.flush()
    return user


def ensure_friendship(user, friend):
    if not Friend.query.filter_by(user_id=user.id, friend_id=friend.id).first():
        db.session.add(Friend(user_id=user.id, friend_id=friend.id))
    if not Friend.query.filter_by(user_id=friend.id, friend_id=user.id).first():
        db.session.add(Friend(user_id=friend.id, friend_id=user.id))


def ensure_direct_conversation(user, friend):
    one, two = sorted([user.id, friend.id])
    conversation = Conversation.query.filter_by(
        type="direct", user_one_id=one, user_two_id=two
    ).first()
    if conversation:
        return conversation
    conversation = Conversation(
        type="direct",
        user_one_id=one,
        user_two_id=two,
        user_one_last_read_at=utc_now() - timedelta(minutes=5),
        user_two_last_read_at=utc_now() - timedelta(minutes=5),
    )
    db.session.add(conversation)
    db.session.flush()
    return conversation


def ensure_group_member(group, user, role="member"):
    member = GroupMember.query.filter_by(group_id=group.id, user_id=user.id).first()
    if member:
        member.is_active = True
        if role == "admin":
            member.role = "admin"
        return member
    member = GroupMember(group_id=group.id, user_id=user.id, role=role)
    db.session.add(member)
    db.session.flush()
    return member


def ensure_group_conversation(group):
    conversation = Conversation.query.filter_by(type="group", group_id=group.id).first()
    if conversation:
        return conversation
    conversation = Conversation(type="group", group_id=group.id, title=group.name)
    db.session.add(conversation)
    db.session.flush()
    return conversation


def add_message(conversation, sender, body, minutes_ago):
    exists = Message.query.filter_by(
        conversation_id=conversation.id, sender_id=sender.id, body=body
    ).first()
    if exists:
        return exists
    created_at = utc_now() - timedelta(minutes=minutes_ago)
    message = Message(
        conversation_id=conversation.id,
        sender_id=sender.id,
        body=body,
        message_type="text",
        status="seen",
        delivered_at=created_at,
        read_at=created_at,
        created_at=created_at,
        updated_at=created_at,
    )
    conversation.last_message_at = created_at
    db.session.add(message)
    return message


def mins_ago(days=0, hours=0, minutes=0):
    return days * 24 * 60 + hours * 60 + minutes


def seed_core_team_direct_chats(ahmed, ayesha, usman, fatima):
    """1:1 threads between core sample users (not the demo account)."""
    ahmed_ayesha = ensure_direct_conversation(ahmed, ayesha)
    add_message(ahmed_ayesha, ayesha, "Sure, ping me if anything breaks on the frontend.", mins_ago(days=4, hours=2))
    add_message(ahmed_ayesha, ahmed, "Will do. Also need your help with the read receipts later.", mins_ago(days=4, hours=1, minutes=40))
    add_message(ahmed_ayesha, ayesha, "Read receipts are already in the model, just wire the UI.", mins_ago(days=3, hours=18))
    add_message(ahmed_ayesha, ahmed, "Nice catch, I missed that.", mins_ago(days=3, hours=17, minutes=55))

    ahmed_usman = ensure_direct_conversation(ahmed, usman)
    add_message(ahmed_usman, usman, "Bro did you finish the README setup section?", mins_ago(days=6, hours=3))
    add_message(ahmed_usman, ahmed, "Almost. Adding the seed script instructions now.", mins_ago(days=6, hours=2, minutes=40))
    add_message(ahmed_usman, usman, "Good. Teacher asked for clear run commands.", mins_ago(days=5, hours=20))
    add_message(ahmed_usman, ahmed, "start_app.cmd and seed_sample_data.cmd should be enough.", mins_ago(days=5, hours=19, minutes=50))
    add_message(ahmed_usman, usman, "Perfect. I will review the screenshots tonight.", mins_ago(days=4, hours=11))
    add_message(ahmed_usman, ahmed, "Thanks man. Let me know if anything is unclear.", mins_ago(days=4, hours=10, minutes=30))
    add_message(ahmed_usman, usman, "One thing — should we mention the demo password in README?", mins_ago(days=2, hours=14))
    add_message(ahmed_usman, ahmed, "Yeah, user / 12345678 is fine for a class project.", mins_ago(days=2, hours=13, minutes=55))
    add_message(ahmed_usman, usman, "Done, pushed my doc edits.", mins_ago(hours=3, minutes=20))

    ayesha_usman = ensure_direct_conversation(ayesha, usman)
    add_message(ayesha_usman, ayesha, "Usman, can you test the group admin remove-member flow?", mins_ago(days=5, hours=6))
    add_message(ayesha_usman, usman, "On it. Which account should I use?", mins_ago(days=5, hours=5, minutes=45))
    add_message(ayesha_usman, ayesha, "Login as ahmed — he is admin in Semester Project Team.", mins_ago(days=5, hours=5, minutes=30))
    add_message(ayesha_usman, usman, "Tested. Remove works, member list updates instantly.", mins_ago(days=4, hours=16))
    add_message(ayesha_usman, ayesha, "Socket event fired correctly?", mins_ago(days=4, hours=15, minutes=50))
    add_message(ayesha_usman, usman, "Yep, no refresh needed.", mins_ago(days=4, hours=15, minutes=35))
    add_message(ayesha_usman, ayesha, "Shukriya. Backend side is solid then.", mins_ago(hours=6, minutes=10))

    ayesha_fatima = ensure_direct_conversation(ayesha, fatima)
    add_message(ayesha_fatima, ayesha, "Fatima, are you free for a quick testing session tonight?", mins_ago(days=3, hours=14))
    add_message(ayesha_fatima, fatima, "Yes, after 8 pm works for me.", mins_ago(days=3, hours=13, minutes=50))
    add_message(ayesha_fatima, ayesha, "Great. We will walk through friend requests and group chats.", mins_ago(days=3, hours=13, minutes=45))
    add_message(ayesha_fatima, fatima, "Should I create a new account or use mine?", mins_ago(days=2, hours=19))
    add_message(ayesha_fatima, ayesha, "Use fatima — already has a pending request to ahmed.", mins_ago(days=2, hours=18, minutes=55))
    add_message(ayesha_fatima, fatima, "Okay, see you tonight inshallah.", mins_ago(hours=5, minutes=25))

    usman_fatima = ensure_direct_conversation(usman, fatima)
    add_message(usman_fatima, fatima, "Reminder: SCD assignment deadline is next Friday.", mins_ago(days=7, hours=10))
    add_message(usman_fatima, usman, "Thanks for the heads up. Slides are half done.", mins_ago(days=6, hours=21))
    add_message(usman_fatima, fatima, "Send me a draft when ready, I will proofread.", mins_ago(days=5, hours=8))
    add_message(usman_fatima, usman, "Will share by tomorrow evening.", mins_ago(hours=4, minutes=50))


def seed_direct_chat(self_user, other_user, script_index, day_offset):
    ensure_friendship(self_user, other_user)
    conversation = ensure_direct_conversation(self_user, other_user)
    script = CHAT_SCRIPTS[script_index % len(CHAT_SCRIPTS)]
    base_minutes = day_offset * 24 * 60
    for index, (role, body) in enumerate(script):
        sender = self_user if role == "self" else other_user
        minutes_ago = base_minutes + (len(script) - index) * 45 + (script_index * 11)
        add_message(conversation, sender, body, minutes_ago)
    return conversation


def seed_group_chat(creator, members, group_info, users_by_name):
    group = Group.query.filter_by(name=group_info["name"]).first()
    if not group:
        group = Group(
            name=group_info["name"],
            description=group_info["description"],
            created_by_id=creator.id,
        )
        db.session.add(group)
        db.session.flush()
    ensure_group_member(group, creator, "admin")
    for member in members:
        ensure_group_member(group, member)
    conversation = ensure_group_conversation(group)
    for index, (username, body) in enumerate(group_info["messages"]):
        sender = users_by_name.get(username)
        if not sender:
            continue
        minutes_ago = (len(group_info["messages"]) - index) * 90 + 120
        add_message(conversation, sender, body, minutes_ago)
    return group


def count_demo_conversations(demo):
    direct_count = Conversation.query.filter(
        Conversation.type == "direct",
        or_(Conversation.user_one_id == demo.id, Conversation.user_two_id == demo.id),
    ).count()
    group_count = (
        Conversation.query.join(Group, Conversation.group_id == Group.id)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .filter(
            Conversation.type == "group",
            GroupMember.user_id == demo.id,
            GroupMember.is_active.is_(True),
        )
        .count()
    )
    return direct_count + group_count


def seed():
    db.create_all()

    ahmed = ensure_user("ahmed", "Ahmed Khan", "Frontend student who likes clean UI.")
    ayesha = ensure_user("ayesha", "Ayesha Siddiqui", "Backend tinkerer and SQLite fan.")
    usman = ensure_user("usman", "Usman Tariq", "Project partner and documentation lead.")
    fatima = ensure_user("fatima", "Fatima Noor", "Testing account for friend requests.")
    demo = ensure_user(
        DEMO_USERNAME,
        "Demo User",
        "Simple demo account for quick university project walkthroughs.",
        password=DEMO_PASSWORD,
        force_password=True,
    )

    core_friends = [ahmed, ayesha, usman, fatima]
    dummy_users = []
    users_by_name = {
        "ahmed": ahmed,
        "ayesha": ayesha,
        "usman": usman,
        "fatima": fatima,
        "demo": demo,
        DEMO_USERNAME: demo,
    }

    for username, display_name, bio in DUMMY_CONTACTS:
        contact = ensure_user(username, display_name, bio)
        dummy_users.append(contact)
        users_by_name[username] = contact

    ensure_friendship(ahmed, ayesha)
    ensure_friendship(ahmed, usman)
    ensure_friendship(ayesha, usman)
    ensure_friendship(ayesha, fatima)
    ensure_friendship(usman, fatima)

    for index, friend in enumerate(core_friends):
        seed_direct_chat(demo, friend, index, day_offset=index + 1)

    for index, contact in enumerate(dummy_users):
        seed_direct_chat(demo, contact, index + 4, day_offset=(index % 14) + 1)

    if not FriendRequest.query.filter_by(sender_id=fatima.id, receiver_id=ahmed.id).first():
        db.session.add(FriendRequest(sender_id=fatima.id, receiver_id=ahmed.id))

    seed_core_team_direct_chats(ahmed, ayesha, usman, fatima)

    direct = ensure_direct_conversation(ahmed, ayesha)
    add_message(direct, ahmed, "Assalam o Alaikum Ayesha, can you review the group chat flow?", 22)
    add_message(direct, ayesha, "Wa Alaikum Assalam, yes, the Socket.IO events are wired nicely.", 18)
    add_message(direct, ahmed, "Great. I will test uploads next.", 12)

    seed_group_chat(
        ahmed,
        [ayesha, usman, demo],
        {
            "name": "Semester Project Team",
            "description": "Sample group for testing messages and admin controls.",
            "messages": [
                ("usman", "I added the setup notes to the README."),
                ("ayesha", "Nice. We should seed demo accounts too."),
                ("demo", "Demo account is ready for the web walkthrough."),
                ("ahmed", "Let's rehearse the viva demo tomorrow."),
                ("usman", "I'll prepare the slides tonight."),
                ("ayesha", "I can handle the live chat demo part."),
                ("demo", "Sounds good. I'll test on mobile too."),
                ("ahmed", "Team, please pull latest before tomorrow's lab."),
                ("ayesha", "Pulled. Migrations ran clean on my machine."),
                ("usman", "Same here. No errors in the console."),
                ("demo", "I will record a short demo video tonight."),
                ("ahmed", "Great idea. Keep it under 3 minutes."),
                ("usman", "Upload to the shared drive when done."),
            ],
        },
        users_by_name,
    )

    for group_info in EXTRA_GROUPS:
        member_usernames = {entry[0] for entry in group_info["messages"]}
        members = [users_by_name[name] for name in member_usernames if name in users_by_name]
        seed_group_chat(demo, members, group_info, users_by_name)

    db.session.commit()

    friend_count = Friend.query.filter_by(user_id=demo.id).count()
    conversation_count = count_demo_conversations(demo)
    message_count = Message.query.count()
    user_count = User.query.count()

    print("Sample data ready.")
    print(f"Demo login: {DEMO_USERNAME} / {DEMO_PASSWORD}")
    print(f"Password for Pakistani Muslim sample users: {SAMPLE_PASSWORD}")
    print(f"Users in database: {user_count}")
    print(f"Demo user friends: {friend_count}")
    print(f"Demo user conversations: {conversation_count}")
    print(f"Total messages: {message_count}")
    print("Re-run safe: existing users, friendships, and messages are skipped (idempotent).")


if __name__ == "__main__":
    app = create_app()
    with app.app_context():
        seed()
