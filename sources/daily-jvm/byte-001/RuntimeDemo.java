public class RuntimeDemo {
    int calculate(int x) {
        return x * 2;
    }
    public static void main(String[] args) {
        RuntimeDemo demo = new RuntimeDemo();
        long total = 0;
        for (int i = 0; i < 1_000_000; i++) {
            total += demo.calculate(i);
        }
        System.out.println(total);
    }
}
