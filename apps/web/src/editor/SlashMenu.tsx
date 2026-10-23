import type { SlashCommand } from './slash';

interface Props {
  id: string;
  commands: readonly SlashCommand[];
  active: number;
  onPick(command: SlashCommand): void;
  onHover(index: number): void;
}

export const optionId = (menuId: string, command: SlashCommand) => `${menuId}-${command.type}`;

/** The `/` command list: an ARIA listbox the textarea (a combobox) points at with aria-activedescendant. */
export function SlashMenu({ id, commands, active, onPick, onHover }: Props) {
  return (
    <ul id={id} role="listbox" aria-label="Block types" className="slash pixel-border">
      {commands.length === 0 && (
        <li className="slash__empty" role="presentation">
          No block type matches
        </li>
      )}
      {commands.map((command, index) => (
        <li
          key={command.type}
          id={optionId(id, command)}
          role="option"
          aria-selected={index === active}
          className="slash__item"
          // keep the caret in the textarea while clicking
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(command)}
          onMouseMove={() => index !== active && onHover(index)}
        >
          <span className="slash__glyph" aria-hidden="true">
            {command.glyph}
          </span>
          <span className="slash__text">
            <span className="slash__label">{command.label}</span>
            <span className="slash__hint">{command.hint}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
