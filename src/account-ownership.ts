type Account = { ownerId: string; ownerName: string };
type Person = { id: string; name: string };
const key = (s: string) =>
  (s || "").normalize("NFKC").replace(/\s/g, "").toLocaleLowerCase();
export function accountOwnedBy(a: Account, person: Person, members: Person[]) {
  if (a.ownerId) return a.ownerId === person.id;
  // Name fallback only when exactly one member has this name.
  return (
    !!key(a.ownerName) &&
    key(a.ownerName) === key(person.name) &&
    members.filter((m) => key(m.name) === key(person.name)).length === 1
  );
}
export function accountInOwnerFilter(
  a: Account,
  filter: string,
  user: Person,
  members: Person[],
) {
  if (filter === "all") return true;
  if (filter.startsWith("name:"))
    return !a.ownerId && key(a.ownerName) === key(filter.slice(5));
  const person = filter === "me" ? user : members.find((m) => m.id === filter);
  return !!person && accountOwnedBy(a, person, members);
}
