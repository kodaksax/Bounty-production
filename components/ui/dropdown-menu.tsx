"use client"

import * as React from "react";
import { View } from "react-native";
import { Button, Divider, Menu } from "react-native-paper";

// Example React Native dropdown menu using react-native-paper
// You must install react-native-paper: npm install react-native-paper

const DropdownMenu: React.FC = () => {
  const [visible, setVisible] = React.useState(false);
  const openMenu = () => setVisible(true);
  const closeMenu = () => setVisible(false);

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
      <Menu
        visible={visible}
        onDismiss={closeMenu}
        anchor={<Button onPress={openMenu}>Show menu</Button>}
      >
        <Menu.Item onPress={() => {}} title="Item 1" leadingIcon="account" />
        <Menu.Item onPress={() => {}} title="Item 2" leadingIcon="star" />
        <Divider />
        <Menu.Item onPress={() => {}} title="Item 3" leadingIcon="settings" />
      </Menu>
    </View>
  );
};

export default DropdownMenu;
