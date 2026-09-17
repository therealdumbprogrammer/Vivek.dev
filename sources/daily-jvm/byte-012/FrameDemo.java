public class FrameDemo {
    int add(int a, int b) {
        int result = a + b;
        return result;
    }

    public static void main(
            String[] args) {
        int sum = new FrameDemo()
            .add(10, 20);
        System.out.println(sum);
    }
}
