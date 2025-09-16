import * as React from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";

export interface ContextMenuItem {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

export interface ContextMenuProps {
  visible: boolean;
  onClose: () => void;
  items: ContextMenuItem[];
  anchorPosition?: { x: number; y: number };
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  visible,
  onClose,
  items,
  anchorPosition,
}) => (
  <Modal
    transparent
    visible={visible}
    animationType="fade"
    onRequestClose={onClose}
  >
    <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
      <View
        style={[
          styles.menu,
          anchorPosition
            ? { position: "absolute", left: anchorPosition.x, top: anchorPosition.y }
            : {},
        ]}
      >
        {items.map((item, idx) => (
          <TouchableOpacity
            key={item.label + idx}
            style={styles.menuItem}
            onPress={() => {
              if (!item.disabled) {
                item.onPress();
                onClose();
              }
            }}
            disabled={item.disabled}
          >
            <Text style={[styles.menuText, item.disabled && styles.disabledText]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </TouchableOpacity>
  </Modal>
);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  menu: {
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingVertical: 8,
    minWidth: 160,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuText: {
    fontSize: 16,
    color: "#222",
  },
  disabledText: {
    color: "#aaa",
  },
});
