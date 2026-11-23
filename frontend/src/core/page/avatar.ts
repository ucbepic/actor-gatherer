// An actor's avatar as the page draws it: how an actor at work is drawn (avatarMode, a setting); its picture, its done
// avatar's grow-in and its hue's main shade, from the stage (core/ui/stage/model.ts), which draws it (Stage.tsx).
export { HUE_MAIN, bareAvatar, restDelay } from "../ui/stage/model";

/** How an actor at work is drawn: "acting" (the stage) or "simple"; set by features/page/look.ts's setAvatarMode, kept
 * in this browser. */
export let avatarMode = "acting";
export const keepAvatarMode = (pick: string): void => {
  avatarMode = pick;
};
