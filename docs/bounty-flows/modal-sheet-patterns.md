# Modal & Sheet Patterns Standard

The application currently features three distinct types of overlay interaction components: `<Dialog>`, `<Sheet>`, and `<Drawer>`. Because these were likely imported or adapted from separate web-first component libraries (like Radix UI), they use drastically different underlying mechanics and have overlapping usage intentions.

This pattern guide establishes a clear boundary for when to use each component to ensure a unified user experience and optimize for React Native performance.

---

## 1. Dialog (`components/ui/dialog.tsx`)

**When to use:** Use for highly disruptive, centered interactions that require immediate user focus and explicit action (e.g., Delete Confirmations, Error Alerts, Critical Disclosures). 

**Mechanics:** Uses the React Native `<Modal>` component.
- The safest option for ensuring it sits on top of all native views (including headers, navigation bars, and maps).
- Follows native iOS/Android lifecycles and handles hardware back buttons reliably on Android via `onRequestClose`.

**Example Usage:**
```tsx
<Dialog open={isOpen} onOpenChange={setIsOpen}>
  <DialogContent>
    <DialogTitle>Are you sure?</DialogTitle>
    <DialogDescription>This action cannot be undone.</DialogDescription>
    <DialogFooter>
      <Button onPress={() => setIsOpen(false)}>Cancel</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

## 2. Sheet (`components/ui/sheet.tsx`)

**When to use:** Use **strictly** for side-navigation or horizontal sliding panels (such as the main mobile `<Sidebar>`). 

**Mechanics:** Uses basic absolute `<View>` wrappers and relies strictly on Tailwind CSS transitions (`className="data-[state=open]:animate-in"`) for animation.
- **Limitation:** It is *not* a React Native Modal. If rendered deeply in the component tree, it might be heavily clipped or obscured by parent `zIndex` or `overflow` boundaries.
- **Pattern:** Do not use `Sheet` for bottom-sheets. Use it only for side sliding menus rendered close to the root of the app.

---

## 3. Drawer (`components/ui/drawer.tsx`)

**When to use:** Use for contextual, non-blocking tasks that expand from the bottom of the screen (e.g., Selecting an Option, Filtering, Context Actions).

**Mechanics:** Uses React Native's `<Animated.View>` with robust `translateY` tracking relative to the device window's `Dimensions`.
- **Why over Sheet?:** The Drawer is built using native JS-driven animations instead of raw CSS classes. This yields smoother layout transitions specific to React Native compared to `Sheet`'s `animate-in` web strategy.
- **Pattern:** Always use `Drawer` instead of `Sheet side="bottom"` for bottom-up menus. 

---

## Refactoring Recommendations (TL;DR)
1. **Never use `<Sheet side="bottom">` or `<Sheet side="top">`**. Migrate any bottom-sheets to `<Drawer>`.
2. **Restrict `<Sheet>`** to strictly handle horizontal fly-outs (like the existing `<Sidebar>` implementation).
3. Ensure any nested components that need to break out of all layouts use `<Dialog>`.
