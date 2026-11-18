export type UserAccount = {
  id: string;
  name: string;
  email: string;
  role: string;
  branch: string;
  branchScope?: "All branches" | "Assigned branch only" | undefined;
  method: "Google" | "Password";
  active: boolean;
  username?: string | undefined;
  password?: string | undefined;
  authUid?: string | undefined;
  joinedDate?: string | undefined;
  createdAt?: string | undefined;
};

export const seedUsers: UserAccount[] = [
  {
    id: "user-geogo3",
    name: "Georges Khoury",
    email: "geogo3@gmail.com",
    username: "geogo3",
    role: "Super Admin",
    branch: "All",
    branchScope: "All branches",
    method: "Password",
    active: true,
  },
  {
    id: "user-piakerbej",
    name: "Pia Kerbej",
    email: "piakerbej@gmail.com",
    username: "piakerbej",
    role: "Super Admin",
    branch: "All",
    branchScope: "All branches",
    method: "Password",
    active: true,
  },
  {
    id: "user-piakerbaje",
    name: "Pia Kerbej",
    email: "piakerbaje@gmail.com",
    username: "piakerbaje",
    role: "Super Admin",
    branch: "All",
    branchScope: "All branches",
    method: "Password",
    active: true,
  },
  {
    id: "user-jesschakh",
    name: "Jess Chakh",
    email: "jess.chakh22@gmail.com",
    username: "jess.chakh22",
    role: "Super Admin",
    branch: "All",
    branchScope: "All branches",
    method: "Password",
    active: true,
  },
];
