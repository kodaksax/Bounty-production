import { Redirect } from "expo-router";
import { CURRENT_USER_ID } from "lib/utils/data-utils";

// Redirect to current user's profile
export default function ProfileIndex() {
  return <Redirect href={`/profile/${CURRENT_USER_ID}`} />;
}
