type ActionDisplayTarget = {
  setTitle(title: string): Promise<void>;
  setImage(image: string): Promise<void>;
};

export async function setActionDisplay(
  action: ActionDisplayTarget,
  title: string,
  imagePath: string
): Promise<void> {
  await action.setTitle(title);
  await action.setImage(imagePath);
}

export async function setConfigNeededDisplay(
  action: ActionDisplayTarget,
  defaultImagePath: string
): Promise<void> {
  await setActionDisplay(action, 'Config needed', defaultImagePath);
}

export async function setErrorDisplay(
  action: ActionDisplayTarget,
  errorImagePath: string
): Promise<void> {
  await setActionDisplay(action, 'Error', errorImagePath);
}
