"""
Methna QA Test System — Fake User Data Generator
Generates realistic Muslim-themed user data for signup simulation.
"""

import random
import uuid
from faker import Faker

fake = Faker()

MUSLIM_FIRST_NAMES_M = [
    "Ahmed", "Mohammed", "Omar", "Ali", "Hassan", "Ibrahim", "Youssef",
    "Khalid", "Tariq", "Bilal", "Hamza", "Zayd", "Idris", "Nabil",
    "Samir", "Rashid", "Faisal", "Jamal", "Karim", "Waleed",
]

MUSLIM_FIRST_NAMES_F = [
    "Fatima", "Aisha", "Mariam", "Khadija", "Zainab", "Nour", "Layla",
    "Amina", "Sara", "Hana", "Yasmin", "Dina", "Rania", "Salma",
    "Samira", "Leila", "Hafsa", "Ruqayya", "Maha", "Iman",
]

MUSLIM_LAST_NAMES = [
    "Al-Rashid", "Al-Hassan", "Al-Farouq", "Abdullah", "Al-Amin",
    "Mansour", "Al-Bakr", "Al-Sayed", "Othman", "Al-Nasser",
    "Khalil", "Al-Qadi", "Mahmoud", "Al-Rafi", "Sharif",
    "Al-Jaziri", "Haddad", "Saleh", "Darwish", "Al-Khatib",
]

GENDERS = ["male", "female"]

EDUCATION_LEVELS = [
    "high_school", "bachelors", "masters", "doctorate", "diploma",
]

MARITAL_STATUSES = ["never_married", "divorced", "widowed"]

RELIGIONS_DETAIL = [
    "sunni", "shia", "sufi", "ibadi", "other",
]

INTERESTS = [
    "reading", "travel", "cooking", "sports", "photography",
    "hiking", "volunteering", "calligraphy", "gardening", "fitness",
    "technology", "art", "music", "writing", "meditation",
]

PROFESSIONS = [
    "Software Engineer", "Doctor", "Teacher", "Architect", "Accountant",
    "Pharmacist", "Lawyer", "Dentist", "Civil Engineer", "Business Analyst",
    "Nurse", "Designer", "Marketing Manager", "Data Scientist", "Journalist",
]


def generate_user(index: int) -> dict:
    """Generate a single fake user with all required fields."""
    uid = uuid.uuid4().hex[:8]
    gender = random.choice(GENDERS)

    if gender == "male":
        first_name = random.choice(MUSLIM_FIRST_NAMES_M)
    else:
        first_name = random.choice(MUSLIM_FIRST_NAMES_F)

    last_name = random.choice(MUSLIM_LAST_NAMES)
    username = f"{first_name.lower()}_{uid}"
    email = f"methna.test.{uid}.{index}@yopmail.com"

    return {
        "email": email,
        "password": "TestP@ss1234",
        "confirmPassword": "TestP@ss1234",
        "firstName": first_name,
        "lastName": last_name,
        "username": username,
        "phone": f"+96650{random.randint(1000000, 9999999)}",
        # Extra profile fields for later steps
        "_meta": {
            "gender": gender,
            "birthday": fake.date_of_birth(minimum_age=20, maximum_age=40).isoformat(),
            "education": random.choice(EDUCATION_LEVELS),
            "marital_status": random.choice(MARITAL_STATUSES),
            "religion_detail": random.choice(RELIGIONS_DETAIL),
            "profession": random.choice(PROFESSIONS),
            "bio": fake.sentence(nb_words=12),
            "interests": random.sample(INTERESTS, k=random.randint(3, 6)),
            "latitude": round(random.uniform(21.0, 31.0), 6),
            "longitude": round(random.uniform(39.0, 55.0), 6),
        },
    }


def generate_users(count: int) -> list[dict]:
    """Generate a batch of fake users."""
    return [generate_user(i) for i in range(count)]
