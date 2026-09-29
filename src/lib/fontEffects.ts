export class FontEffectsError extends Error {
  editId?: string;
  readonly code = 'FONT_EFFECTS';
  constructor(effect: string) {
    super(
      `This line uses ${effect}, which cannot be retained when changing its font. You can replace this line as plain text, or keep the original text.`,
    );
  }
}
