type KeyboardLikeEvent = {
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
  };
};

export function isImeComposing(event: KeyboardLikeEvent, composing = false): boolean {
  const nativeEvent = event.nativeEvent;
  return Boolean(
    composing ||
      event.isComposing ||
      nativeEvent?.isComposing ||
      event.keyCode === 229 ||
      event.which === 229 ||
      nativeEvent?.keyCode === 229 ||
      nativeEvent?.which === 229,
  );
}
