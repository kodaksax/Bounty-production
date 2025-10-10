import { Redirect } from "expo-router";
import { getCurrentUserId } from "lib/utils/data-utils";

// Redirect to current user's profile
export default function ProfileIndex() {
  const currentUserId = getCurrentUserId();
  return <Redirect href={`/profile/${currentUserId}`} />;
}
