"""Locale/translation management. 'en' and 'el' ship built into the frontend
bundle so the app works before this table has any rows; anything a super
admin adds here (a new locale, or an override for an existing string) takes
precedence at read time, key-by-key, over the bundled defaults.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import Locale, TranslationOverride
from app.schemas import LocaleCreate, LocaleSummary, TranslationsUpdate
from app.services.authorization import require_super_admin

router = APIRouter(tags=["translations"])


@router.get("/locales", response_model=list[LocaleSummary])
async def list_locales(db: Session = Depends(get_db)) -> list[LocaleSummary]:
    locales = db.scalars(select(Locale).order_by(Locale.is_builtin.desc(), Locale.code)).all()
    return [LocaleSummary(code=l.code, name=l.name, is_builtin=l.is_builtin) for l in locales]


@router.get("/translations/{locale}")
async def get_translation_overrides(locale: str, db: Session = Depends(get_db)) -> dict[str, str]:
    overrides = db.scalars(select(TranslationOverride).where(TranslationOverride.locale == locale)).all()
    return {o.key: o.value for o in overrides}


@router.post("/admin/locales", response_model=LocaleSummary, status_code=status.HTTP_201_CREATED)
async def create_locale(
    payload: LocaleCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> LocaleSummary:
    require_super_admin(user)
    code = payload.code.strip().lower()
    if db.get(Locale, code):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Locale already exists")

    locale = Locale(code=code, name=payload.name.strip(), is_builtin=False)
    db.add(locale)
    db.commit()
    return LocaleSummary(code=locale.code, name=locale.name, is_builtin=False)


@router.delete("/admin/locales/{code}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_locale(
    code: str,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    require_super_admin(user)
    locale = db.get(Locale, code)
    if not locale:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Locale not found")
    if locale.is_builtin:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete a built-in locale")

    for override in db.scalars(select(TranslationOverride).where(TranslationOverride.locale == code)).all():
        db.delete(override)
    db.delete(locale)
    db.commit()


@router.patch("/admin/translations/{locale}", status_code=status.HTTP_204_NO_CONTENT)
async def update_translations(
    locale: str,
    payload: TranslationsUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    require_super_admin(user)
    if not db.get(Locale, locale):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Locale not found")

    for key, value in payload.values.items():
        existing = db.scalars(
            select(TranslationOverride).where(TranslationOverride.locale == locale, TranslationOverride.key == key)
        ).first()
        if not value:
            # empty value = revert to the bundled default
            if existing:
                db.delete(existing)
        elif existing:
            existing.value = value
        else:
            db.add(TranslationOverride(locale=locale, key=key, value=value))
    db.commit()
