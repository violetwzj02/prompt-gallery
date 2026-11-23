import { PENDING_CHARACTER } from '../utils/quyiCharacters'

export interface CharacterNavItem {
  id: string
  name: string
  count: number
  pending?: boolean
}

interface Props {
  characters: CharacterNavItem[]
  activeId: string | null
  totalCount: number
  onSelect: (collectionId: string | null) => void
}

export function CharacterSubnav({ characters, activeId, totalCount, onSelect }: Props) {
  if (characters.length === 0) return null
  return (
    <nav className="character-subnav" aria-label="18+ 角色子导航">
      <p className="character-subnav__label">角色</p>
      <div className="character-subnav__chips">
        <button
          type="button"
          className={`character-chip ${activeId === null ? 'is-active' : ''}`}
          onClick={() => onSelect(null)}
        >
          全部 <span>{totalCount}</span>
        </button>
        {characters.map((character) => (
          <button
            type="button"
            key={character.id}
            className={`character-chip${character.pending ? ' is-pending' : ''}${activeId === character.id ? ' is-active' : ''}`}
            onClick={() => onSelect(character.id === activeId ? null : character.id)}
          >
            {character.name}
            <span>{character.count}</span>
          </button>
        ))}
      </div>
      {activeId && characters.find((c) => c.id === activeId)?.pending && (
        <p className="character-subnav__hint">
          「{PENDING_CHARACTER}」收录尚未具名或提示词不全的条目，不会被随意起名。
        </p>
      )}
    </nav>
  )
}
