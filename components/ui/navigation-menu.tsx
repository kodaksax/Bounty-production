import { useNavigation } from '@react-navigation/native';
import * as React from "react";
import { StyleProp, Text, ViewStyle } from "react-native";
import { Appbar, IconButton, Menu } from 'react-native-paper';

// Type for menu items
export type NavMenuItem = {
  title: string;
  route: string;
  icon?: string;
};

export type NavigationMenuProps = {
  menuItems?: NavMenuItem[];
  style?: StyleProp<ViewStyle>;
};

const NavigationMenu: React.FC<NavigationMenuProps> = ({ menuItems = [], style }) => {
  const navigation = useNavigation();
  const [visible, setVisible] = React.useState(false);
  const openMenu = () => setVisible(true);
  const closeMenu = () => setVisible(false);

  return (
    <Appbar style={style}>
      <IconButton icon="menu" onPress={openMenu} />
      <Menu
        visible={visible}
        onDismiss={closeMenu}
        anchor={<Text onPress={openMenu}>Menu</Text>}
      >
        {menuItems.map((item, idx) => (
          <Menu.Item
            key={idx}
            onPress={() => {
              // navigation.navigate is typed based on your navigator; cast to any for flexibility
              (navigation as any).navigate(item.route);
              closeMenu();
            }}
            title={item.title}
          />
        ))}
      </Menu>
    </Appbar>
  );
};

export { NavigationMenu };

