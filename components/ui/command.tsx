import * as React from "react"
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native"

type CommandItemType = {
  label: string
  value: string
  icon?: React.ReactNode
  disabled?: boolean
}

type CommandPaletteProps = {
  visible: boolean
  onClose: () => void
  items: CommandItemType[]
  onSelect: (item: CommandItemType) => void
  placeholder?: string
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  visible,
  onClose,
  items,
  onSelect,
  placeholder = "Type a command...",
}) => {
  const [query, setQuery] = React.useState("")
  const filteredItems = items.filter(
    (item) =>
      item.label.toLowerCase().includes(query.toLowerCase()) ||
      item.value.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <TextInput
            style={styles.input}
            placeholder={placeholder}
            value={query}
            onChangeText={setQuery}
            autoFocus
          />
          {filteredItems.length === 0 ? (
            <Text style={styles.empty}>No results found</Text>
          ) : (
            <FlatList
              data={filteredItems}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.item, item.disabled && styles.disabled]}
                  onPress={() => !item.disabled && onSelect(item)}
                  disabled={item.disabled}
                >
                  {item.icon && <View style={styles.icon}>{item.icon}</View>}
                  <Text style={styles.label}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          )}
          <TouchableOpacity style={styles.close} onPress={onClose}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    width: "90%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  input: {
    height: 44,
    borderColor: "#ddd",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 4,
    backgroundColor: "#f7f7f7",
  },
  label: {
    fontSize: 16,
    color: "#222",
  },
  icon: {
    marginRight: 8,
  },
  disabled: {
    opacity: 0.5,
  },
  empty: {
    textAlign: "center",
    color: "#888",
    marginVertical: 16,
  },
  close: {
    marginTop: 12,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#eee",
  },
  closeText: {
    color: "#333",
    fontSize: 15,
  },
})
