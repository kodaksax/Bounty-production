"use client"

import * as React from "react";
import { Text } from "react-native";
import { Appbar, IconButton, Menu } from "react-native-paper";
// Basic Menubar implementation using react-native-paper
// You can customize the menu items and structure as needed

type MenubarItem = {
  title: string;
  onPress: () => void;
  icon?: React.ReactNode;
};

type MenubarProps = {
  menuItems?: MenubarItem[];
  style?: any;
};

const Menubar: React.FC<MenubarProps> = ({ menuItems = [], style, ...props }) => {
  const [visible, setVisible] = React.useState(false);
  const openMenu = () => setVisible(true);
  const closeMenu = () => setVisible(false);

  return (
    <Appbar style={style} {...props}>
      <IconButton icon="menu" onPress={openMenu} />
      <Menu
        visible={visible}
        onDismiss={closeMenu}
        anchor={<Text onPress={openMenu}>Menu</Text>}
      >
        {menuItems.map((item, idx) => (
          <Menu.Item
            key={idx}
            onPress={item.onPress}
            title={item.title}
            // If you want to show an icon, you can wrap Menu.Item with a View and add the icon manually
          />
        ))}
      </Menu>
    </Appbar>
  );
};

export { Menubar };

